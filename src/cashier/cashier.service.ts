import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { createHmac } from 'crypto'
import { PaymentOrder, Prisma } from '@prisma/client'
import {
  PaymentOrderStatus,
  MerchantStatus,
  QrCodeStatus,
  QrCodeType,
  RealNameStatus,
  NotifyStatus,
  UserStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import type { RechargeRequest } from '../payment-channels/payment-channel.interface'
import { fenToYuan, generateOrderNo, generatePaymentNo, isCallbackUrlSafe, postJsonPinned, yuanToFen } from '../common/helpers'
import { escapeCsvField } from '../common/csv'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  buildLockKey,
  CALLBACK_TIMEOUT_MS,
  DASHBOARD_MONTH_DAYS,
  DASHBOARD_WEEK_DAYS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PAYMENT_DAILY_LIMIT_CENTS,
  MAX_CALLBACK_RETRIES,
  MAX_EXPORT_ROWS,
  MAX_PAGE_SIZE,
  NOTIFY_RETRY_BACKOFF_MS,
  NOTIFY_RETRY_BATCH_SIZE,
  ORDER_EXPIRY_MS,
  RATE_DENOMINATOR,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'

@Injectable()
export class CashierService {
  private readonly logger = new Logger(CashierService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
  ) {}

  /**
   * 发起渠道支付（合规聚合模式：用户通过微信/支付宝直接付款，资金由持牌通道清算，
   * 平台不经手资金，仅更新订单状态并在回调后通知商户）
   */
  async createChannelPay(
    payerId: string,
    orderNo: string,
    channelCode: string,
    options?: { payMethod?: string; clientIp?: string },
  ) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
      include: { merchant: true },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))

    if (order.status !== PaymentOrderStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.ORDER_STATUS_CHANGED))
    }
    if (order.merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_CANNOT_RECEIVE))
    }

    // 付款方校验：实名是聚合收单的强制要求（特约商户/支付合规）
    const payer = await this.usersService.findById(payerId)
    if (!payer) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND, '付款用户不存在'))
    if (payer.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (payer.status === UserStatus.FROZEN || payer.status === UserStatus.EXPENSE_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户当前禁止支出'))
    }

    // 风控检查：拦截高风险交易
    const riskResult = await this.riskEngine.check({
      userId: payerId,
      type: 'PAYMENT',
      amount: order.amount,
    })
    if (riskResult.blocked) {
      throw new ForbiddenException(
        kbError(
          KBErrorCodes.FORBIDDEN,
          `支付被风控拦截：${riskResult.rules.filter(r => r.action === 'BLOCK').map(r => r.name).join('、')}`,
        ),
      )
    }

    // 渠道可用性：注册存在 + 已启用配置
    const channel = this.channelRegistry.getChannel(channelCode)
    let channelConfig
    try {
      channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
    } catch {
      channelConfig = null
    }
    if (!channel || !channelConfig) {
      throw new BadRequestException(
        kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, `支付渠道不可用或未配置: ${channelCode}`),
      )
    }

    // 订单绑定渠道（原子）：防止同一订单并发发起多个渠道
    const claimed = await this.prisma.paymentOrder.updateMany({
      where: { id: order.id, status: PaymentOrderStatus.PENDING, channel: null },
      data: { channel: channelCode },
    })
    if (claimed.count === 0) {
      const latest = await this.prisma.paymentOrder.findUnique({
        where: { id: order.id },
        select: { channel: true, channelOrderNo: true },
      })
      if (latest?.channel && latest.channel !== channelCode) {
        throw new BadRequestException(kbError(KBErrorCodes.ORDER_STATUS_CHANGED, '订单已绑定其他支付渠道'))
      }
      // 同一渠道重复发起：幂等返回已生成支付链接
      if (latest?.channelOrderNo) {
        return {
          orderNo: order.orderNo,
          channel: channelCode,
          payUrl: this.buildChannelPayUrl(latest.channelOrderNo),
        }
      }
    }

    // 组装渠道支付参数
    const baseNotifyUrl =
      process.env.CHANNEL_NOTIFY_URL || `${process.env.CASHIER_BASE_URL || 'http://localhost:3001'}/webhooks/recharge`
    const notifyUrl = `${baseNotifyUrl}/${channelCode}`
    const payMethod = options?.payMethod || (channelCode === 'wechat' ? 'h5' : 'wap')
    const req: RechargeRequest = {
      orderNo: order.orderNo,
      amount: order.amount,
      userId: payerId,
      subject: order.subject || order.orderNo,
      notifyUrl,
      channelConfig: channelConfig.config,
      payMethod,
      ...(options?.clientIp ? { clientIp: options.clientIp } : {}),
    }

    const resp = await channel.createRecharge(req)
    if (!resp.payUrl && !resp.payParams) {
      throw new BadRequestException(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '渠道未返回支付参数'))
    }

    // 持久化渠道单号
    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: { channelOrderNo: resp.channelOrderNo },
    })

    return {
      orderNo: order.orderNo,
      channel: channelCode,
      payUrl: resp.payUrl || '',
      payParams: resp.payParams || null,
    }
  }

  private buildChannelPayUrl(channelOrderNo: string): string {
    return `${process.env.CASHIER_BASE_URL || 'http://localhost:3001'}/#cashier?orderNo=${channelOrderNo}`
  }

  async createOrder(
    userId: string,
    dto: {
      merchantOrderNo: string
      amount: number
      subject: string
      body?: string
      callbackUrl?: string
      expiredAt?: Date
    },
  )
  {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new ForbiddenException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER))
    }
    const amount = yuanToFen(dto.amount)

    const existing = await this.prisma.paymentOrder.findFirst({
      where: {
        merchantId: merchant.id,
        merchantOrderNo: dto.merchantOrderNo,
      },
    })
    if (existing) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_ORDER_NO_EXISTS))
    }

    if (dto.callbackUrl) {
      await this.validateCallbackUrl(dto.callbackUrl)
    }

    const expiredAt =
      dto.expiredAt || new Date(Date.now() + ORDER_EXPIRY_MS)
    if (expiredAt <= new Date()) {
      throw new BadRequestException(kbError(KBErrorCodes.EXPIRED_TIME_INVALID))
    }
    const orderNo = generatePaymentNo()

    try {
      const order = await this.prisma.paymentOrder.create({
        data: {
          merchantId: merchant.id,
          merchantOrderNo: dto.merchantOrderNo,
          orderNo,
          amount,
          subject: dto.subject,
          body: dto.body,
          callbackUrl: dto.callbackUrl,
          expiredAt,
        },
      })

      return this.formatOrder(order)
    } catch (e) {
      // 并发场景下唯一约束冲突：两个请求同时通过上方的存在性检查时，
      // 第二个 create 会触发 P2002，查回原单幂等返回，避免商户并发重试拿不到已创建订单
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existed = await this.prisma.paymentOrder.findFirst({
          where: {
            merchantId: merchant.id,
            merchantOrderNo: dto.merchantOrderNo,
          },
        })
        if (existed) return this.formatOrder(existed)
        throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_ORDER_NO_EXISTS))
      }
      throw e
    }
  }

  async getOrder(orderNo: string, userId?: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
      include: {
        merchant: { select: { merchantNo: true, merchantName: true } },
      },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
    // 收银台公开查询仅返回支付所需的最少信息，不暴露 merchantNo 等商户敏感字段
    return {
      orderNo: order.orderNo,
      merchantName: order.merchant?.merchantName || '-',
      subject: order.subject,
      amountYuan: fenToYuan(order.amount),
      status: order.status,
      expiredAt: order.expiredAt,
    }
  }

  async closeExpiredOrders() {
    const now = new Date()
    const result = await this.prisma.paymentOrder.updateMany({
      where: {
        status: PaymentOrderStatus.PENDING,
        expiredAt: { lt: now },
      },
      data: {
        status: PaymentOrderStatus.CLOSED,
      },
    })
    this.logger.log(`已关闭 ${result.count} 条过期订单`)

    // 补偿通知：已付款但 notifyStatus 仍为 PENDING/FAILED 且超过退避时长的订单，
    // 触发一次重试，避免商户因首次通知失败而漏发货
    await this.retryStaleNotifications(now)
  }

  // 补偿通知：已付款但通知未成功的订单
  private async retryStaleNotifications(now: Date) {
    const cutoff = new Date(now.getTime() - NOTIFY_RETRY_BACKOFF_MS)
    const staleOrders = await this.prisma.paymentOrder.findMany({
      where: {
        status: PaymentOrderStatus.PAID,
        paidAt: { lt: cutoff },
        notifyStatus: { in: [NotifyStatus.PENDING, NotifyStatus.FAILED] },
        // 留存 callbackUrl 才有重试意义
        callbackUrl: { not: null },
      },
      select: {
        id: true,
        orderNo: true,
        merchantOrderNo: true,
        amount: true,
        paidAt: true,
        callbackUrl: true,
        appId: true,
      },
      take: NOTIFY_RETRY_BATCH_SIZE,
      orderBy: { paidAt: 'asc' },
    })

    if (staleOrders.length === 0) return

    this.logger.warn(`发现 ${staleOrders.length} 条已付款但通知未完成的订单，开始补偿重试`)

    // 串行重试，避免一次性打爆商户端；notifyMerchant 内部已有锁 + 幂等保护。
    // status 已被 where 限定为 PAID，显式传入以满足 notifyMerchant 类型签名
    for (const order of staleOrders) {
      try {
        await this.notifyMerchant({ ...order, status: PaymentOrderStatus.PAID })
      } catch (err) {
        this.logger.error(`补偿通知订单 ${order.orderNo} 失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // 商户回调通知：POST callbackUrl，带 X-KB-Signature 签名头，最多重试 5 次
  async notifyMerchant(order: {
    id: string
    orderNo: string
    merchantOrderNo: string
    amount: number
    status: PaymentOrderStatus
    paidAt: Date | null
    callbackUrl: string | null
    appId: string | null
  }) {
    if (!order.callbackUrl) {
      return { notifyStatus: NotifyStatus.PENDING, notifyCount: 0 }
    }

    // 在闭包外捕获 callbackUrl，避免 TS 在闭包内无法窄化对象属性类型
    const callbackUrl = order.callbackUrl

    // H4: 同一订单的回调通知加分布式锁，防止支付后异步通知与商户手动重试并发执行，
    // 导致重复回调商户 / notifyStatus 与 notifyCount 互相覆盖。锁内重新读取订单状态，
    // 已通知成功的直接幂等返回，避免重复发货。
    return this.redis.withLock(buildLockKey('cashier:notify', order.id),
      REDIS_LOCK_TTL_SECONDS,
      async () => {
        // 锁内重新读取订单，已通知成功则幂等返回，避免重复通知商户
        const latest = await this.prisma.paymentOrder.findUnique({
          where: { id: order.id },
          select: { notifyStatus: true, notifyCount: true, callbackUrl: true },
        })
        if (latest?.notifyStatus === NotifyStatus.SUCCESS) {
          return {
            notifyStatus: latest.notifyStatus,
            notifyCount: latest.notifyCount,
          }
        }

        // 通知前再次校验回调地址：订单创建后可能因 DNS rebinding 指向内网，
        // 此时不应发起请求，直接标记通知失败
        const urlCheck = await isCallbackUrlSafe(callbackUrl)
        if (!urlCheck.safe) {
          this.logger.warn(
            `订单 ${order.orderNo} 回调地址不安全: ${urlCheck.reason}`,
          )
          const blocked = await this.prisma.paymentOrder.update({
            where: { id: order.id },
            data: { notifyStatus: NotifyStatus.FAILED, notifyCount: 0 },
          })
          return {
            notifyStatus: blocked.notifyStatus,
            notifyCount: blocked.notifyCount,
          }
        }

        let appSecret = ''
        if (order.appId) {
          const app = await this.prisma.merchantApp.findUnique({
            where: { appId: order.appId },
            select: { appSecret: true },
          })
          appSecret = app?.appSecret || ''
        }

        const payload = {
          orderNo: order.orderNo,
          merchantOrderNo: order.merchantOrderNo,
          amount: order.amount,
          amountYuan: fenToYuan(order.amount),
          status: order.status,
          paidAt: order.paidAt,
        }
        const body = JSON.stringify(payload)
        // DB 中 appSecret 为 SHA-256 hex 摘要（见 API_REFERENCE.md 回调验签协议）：
        // 商户侧以 sha256(明文 appSecret) 的 32 字节原始摘要为 HMAC 密钥验证，
        // 此处用 Buffer.from(hex, 'hex') 复现同一字节序列，不得直接用 hex 字符串作密钥
        const signature = createHmac('sha256', Buffer.from(appSecret, 'hex'))
          .update(body)
          .digest('hex')

        const maxRetries = MAX_CALLBACK_RETRIES
        let attempts = 0
        let success = false
        for (let i = 0; i < maxRetries; i++) {
          attempts += 1
          try {
            // SSRF 加固：固定解析 IP 直连（消除 DNS rebinding TOCTOU 窗口），不跟随重定向
            const resp = await postJsonPinned(
              callbackUrl,
              body,
              {
                'Content-Type': 'application/json',
                'X-KB-Signature': signature,
              },
              CALLBACK_TIMEOUT_MS,
            )
            if (resp.ok) {
              success = true
              break
            }
            this.logger.warn(
              `订单 ${order.orderNo} 回调第 ${attempts} 次失败，HTTP ${resp.status}`,
            )
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            this.logger.warn(
              `订单 ${order.orderNo} 回调第 ${attempts} 次异常: ${message}`,
            )
          }
          // 指数退避：1s, 2s, 4s, 8s, 16s
          if (i < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000))
          }
        }

        const updated = await this.prisma.paymentOrder.update({
          where: { id: order.id },
          data: {
            notifyStatus: success ? NotifyStatus.SUCCESS : NotifyStatus.FAILED,
            notifyCount: attempts,
          },
        })

        return {
          notifyStatus: updated.notifyStatus,
          notifyCount: updated.notifyCount,
        }
      },
    )
  }

  // 手动重试回调通知（商户自身触发）
  async retryNotify(userId: string, orderNo: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
    if (order.merchantId !== merchant.id) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订单'))
    }
    if (!order.callbackUrl) {
      throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_URL_NOT_SET))
    }
    // 已通知成功的订单不再重复通知，避免给商户重复发货的入口
    if (order.notifyStatus === NotifyStatus.SUCCESS) {
      throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_ALREADY_SUCCESS))
    }

    return this.notifyMerchant({ ...order, status: order.status as PaymentOrderStatus })
  }

  async listMyOrders(
    userId: string,
    query: {
      status?: PaymentOrderStatus
      startDate?: string
      endDate?: string
      page?: number
      limit?: number
    },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    // 非商户钱包用户没有收款订单，返回空分页而不是 404——404 语义错位且前端难处理
    if (!merchant) {
      return { data: [], total: 0, page: 1, limit: 20 }
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))
    const where: Prisma.PaymentOrderWhereInput = { merchantId: merchant.id }
    if (query.status) {
      where.status = query.status
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00`)
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59`)
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.paymentOrder.count({ where }),
    ])

    return {
      data: data.map((o) => this.formatOrder(o)),
      total,
      page,
      limit,
    }
  }

  // 商户对账导出，生成 Excel 兼容的 CSV 字符串
  async exportMyOrders(
    userId: string,
    query: {
      startDate?: string
      endDate?: string
      status?: PaymentOrderStatus
    },
  )
  : Promise<string> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const where: Prisma.PaymentOrderWhereInput = { merchantId: merchant.id }
    if (query.status) {
      where.status = query.status
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00`)
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59`)
      }
    }

    // 不分页，但限制最多 MAX_EXPORT_ROWS 条防止滥用
    const orders = await this.prisma.paymentOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT_ROWS,
    })

    const statusMap: Record<string, string> = {
      PENDING: '待支付',
      PAID: '已支付',
      CLOSED: '已关闭',
      EXPIRED: '已过期',
      REFUNDED: '已退款',
    }

    const header =
      '订单号,商户订单号,金额(元),手续费(元),实收(元),状态,创建时间,支付时间'
    const lines = orders.map((o) => {
      const actualAmount = o.amount - (o.fee || 0)
      return [
        o.orderNo,
        o.merchantOrderNo,
        fenToYuan(o.amount),
        fenToYuan(o.fee || 0),
        fenToYuan(actualAmount),
        statusMap[o.status] || o.status,
        this.formatDateTime(o.createdAt),
        o.paidAt ? this.formatDateTime(o.paidAt) : '',
      ]
        .map((v) => escapeCsvField(String(v)))
        .join(',')
    })

    // UTF-8 BOM 让 Excel 正确识别中文
    return '\uFEFF' + header + '\n' + lines.join('\n')
  }

  // 商户对账汇总，按日统计已支付订单
  async reconciliation(
    userId: string,
    query: { startDate?: string; endDate?: string },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { userId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const where: Prisma.PaymentOrderWhereInput = {
      merchantId: merchant.id,
      status: PaymentOrderStatus.PAID,
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00`)
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59`)
      }
    }

    const orders = await this.prisma.paymentOrder.findMany({
      where,
      select: { amount: true, fee: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    // 按日分组统计
    const dailyMap = new Map<
      string,
      { count: number; amount: number; fee: number }
    >()
    for (const order of orders) {
      const date = this.formatDate(order.createdAt)
      const entry = dailyMap.get(date) || { count: 0, amount: 0, fee: 0 }
      entry.count += 1
      entry.amount += order.amount
      entry.fee += order.fee || 0
      dailyMap.set(date, entry)
    }

    const data = Array.from(dailyMap.entries()).map(([date, v]) => ({
      date,
      count: v.count,
      amountYuan: fenToYuan(v.amount),
      feeYuan: fenToYuan(v.fee),
      netYuan: fenToYuan(v.amount - v.fee),
    }))

    const totalAmount = orders.reduce((s, o) => s + o.amount, 0)
    const totalFee = orders.reduce((s, o) => s + (o.fee || 0), 0)
    const summary = {
      count: orders.length,
      amountYuan: fenToYuan(totalAmount),
      feeYuan: fenToYuan(totalFee),
      netYuan: fenToYuan(totalAmount - totalFee),
    }

    return { data, summary }
  }

  // 根据商户收款码查商户信息，供收银台展示
  async getQrCodeOrderInfo(code: string) {
    const qrCode = await this.prisma.qrCode.findUnique({
      where: { code },
      include: { merchant: true },
    })
    if (!qrCode) throw new NotFoundException(kbError(KBErrorCodes.QR_CODE_NOT_FOUND))
    if (qrCode.type !== QrCodeType.MERCHANT) {
      throw new BadRequestException(kbError(KBErrorCodes.QR_CODE_NOT_MERCHANT))
    }
    if (qrCode.status !== QrCodeStatus.ACTIVE) {
      throw new BadRequestException(kbError(KBErrorCodes.QR_CODE_EXPIRED))
    }
    if (!qrCode.merchant) {
      throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_INFO_NOT_FOUND))
    }
    if (qrCode.merchant.status !== MerchantStatus.APPROVED) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_STATUS_ABNORMAL))
    }

    const merchant = qrCode.merchant
    const remark = qrCode.remark || ''
    return {
      merchantNo: merchant.merchantNo,
      merchantName: merchant.merchantName,
      amountYuan: qrCode.amount ? fenToYuan(qrCode.amount) : null,
      remark,
      subject: remark || `向${merchant.merchantName}付款`,
    }
  }

  private async validateCallbackUrl(url: string) {
    const result = await isCallbackUrlSafe(url)
    if (!result.safe) {
      const code = result.reason === 'CALLBACK_URL_PROTOCOL_INVALID'
        ? KBErrorCodes.CALLBACK_URL_PROTOCOL_INVALID
        : result.reason === 'CALLBACK_URL_INTERNAL'
          ? KBErrorCodes.CALLBACK_URL_INTERNAL
          : KBErrorCodes.INVALID_PARAMETER
      throw new BadRequestException(kbError(code))
    }
  }

  private formatOrder(order: PaymentOrder) {
    return {
      ...order,
      amountYuan: fenToYuan(order.amount),
      feeYuan: fenToYuan(order.fee),
    }
  }

  // 格式化为 YYYY-MM-DD HH:mm:ss
  private formatDateTime(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds(),
    )}`
  }

  // 格式化为 YYYY-MM-DD
  private formatDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}`
  }
}
