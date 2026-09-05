import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TransactionStatus, PaymentOrderStatus, LedgerType, Direction, RiskEventType, RiskLevel, BillType, BillDirection } from '../common/enums'
import { RedisService } from '../redis/redis.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { PaymentChannelBridge } from './payment-channel.bridge'
import { RefundRequest, RefundResponse, ChannelConfig } from './payment-channel.interface'
import { generateOrderNo, fenToYuan } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { REDIS_LOCK_TTL_SECONDS } from '../common/constants'
import { JournalService } from '../finance/journal.service'

/**
 * 统一退款服务
 *
 * 提供：
 * - 统一退款接口（自动路由到对应渠道）
 * - 退款状态查询
 * - 退款回调处理
 * - 退款状态跟踪
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly channelBridge: PaymentChannelBridge,
    private readonly riskEngine: RiskEngineService,
    private readonly journalService: JournalService,
  ) {}

  /**
   * 发起退款
   *
   * @param orderNo 原支付订单号
   * @param amount  退款金额（分）
   * @param reason  退款原因
   * @param idempotencyKey 幂等键
   */
  async createRefund(
    orderNo: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<{
    refundNo: string
    channelRefundNo: string
    status: string
    message?: string
  }> {
    if (amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_INVALID))
    }

    return this.redis.withLock(`refund:create:${orderNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      // 查找原订单
      const order = await this.prisma.transactionOrder.findUnique({
        where: { orderNo },
      })
      if (!order) {
        throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '原支付订单不存在'))
      }

      // 检查订单状态
      if (order.status !== TransactionStatus.SUCCESS) {
        throw new BadRequestException(kbError(KBErrorCodes.ORDER_NOT_REFUNDABLE, '订单状态不可退款'))
      }

      // 检查退款金额
      const refundableAmount = order.amount - (order.fee || 0)
      if (amount > refundableAmount) {
        throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_EXCEEDED))
      }

      // 聚合历史退款校验：单次上限校验无法防止换幂等键反复部分退款，
      // 必须累加原订单所有 PROCESSING/SUCCESS 退款后与可退总额比较
      const priorRefunds = await this.prisma.transactionOrder.aggregate({
        where: {
          relatedOrderNo: orderNo,
          status: { in: [TransactionStatus.PROCESSING, TransactionStatus.SUCCESS] },
        },
        _sum: { amount: true },
      })
      const refundedTotal = priorRefunds._sum.amount || 0
      if (refundedTotal + amount > refundableAmount) {
        throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_EXCEEDED))
      }

      // 幂等检查
      if (idempotencyKey) {
        const existing = await this.prisma.transactionOrder.findFirst({
          where: {
            idempotencyKey,
            type: 'REFUND',
          },
        })
        if (existing) {
          return {
            refundNo: existing.orderNo,
            channelRefundNo: existing.channelOrderNo || '',
            status: existing.status,
          }
        }
      }

      // 获取渠道配置（渠道实例由桥接层按编码解析）
      const channelConfig = await this.channelRegistry.getEnabledConfig(order.channel || 'mock')

      const refundNo = generateOrderNo('RF')

      // 创建退款订单（PENDING → PROCESSING → SUCCESS/FAILED）
      const refundOrder = await this.prisma.transactionOrder.create({
        data: {
          orderNo: refundNo,
          type: 'REFUND' as any,
          status: TransactionStatus.PENDING,
          amount,
          toUserId: order.toUserId,
          fromUserId: order.fromUserId,
          channel: order.channel,
          relatedOrderNo: orderNo,
          idempotencyKey,
          remark: reason || '用户退款',
        },
      })

      // 调用渠道退款前先置 PROCESSING，防止 queryRefund 在渠道调用期间重复扣款
      await this.prisma.transactionOrder.update({
        where: { id: refundOrder.id },
        data: { status: TransactionStatus.PROCESSING },
      })

      // 调用渠道退款
      const refundRequest: RefundRequest = {
        orderNo,
        refundNo,
        amount,
        reason: reason || '用户退款',
        channelOrderNo: order.channelOrderNo || orderNo,
        channelConfig: channelConfig.config,
      }

      let refundResult: RefundResponse
      try {
        refundResult = await this.channelBridge.refund(order.channel || 'mock', refundRequest)
      } catch (error) {
        // 渠道退款失败，更新订单状态
        await this.prisma.transactionOrder.update({
          where: { id: refundOrder.id },
          data: {
            status: TransactionStatus.FAILED,
            completedAt: new Date(),
            remark: `退款失败：${error instanceof Error ? error.message : '未知错误'}`,
          },
        })
        throw new BadRequestException(
          kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, `退款渠道调用失败：${error instanceof Error ? error.message : '未知错误'}`),
        )
      }

      // 更新退款订单的渠道退款号
      await this.prisma.transactionOrder.update({
        where: { id: refundOrder.id },
        data: {
          channelOrderNo: refundResult.channelRefundNo,
          status: refundResult.status === 'SUCCESS'
            ? TransactionStatus.SUCCESS
            : refundResult.status === 'FAILED'
              ? TransactionStatus.FAILED
              : TransactionStatus.PENDING,
          completedAt: refundResult.status === 'SUCCESS' || refundResult.status === 'FAILED'
            ? new Date()
            : undefined,
        },
      })

      // 如果退款直接成功，处理资金退回（统一入口：锁 + 账本键幂等 + 双腿分录）
      if (refundResult.status === 'SUCCESS') {
        await this.processRefundSuccess(refundNo)
      }

      return {
        refundNo,
        channelRefundNo: refundResult.channelRefundNo,
        status: refundResult.status,
        message: refundResult.message,
      }
    })
  }

  /**
   * 查询退款状态
   */
  async queryRefund(refundNo: string): Promise<{
    refundNo: string
    status: string
    message?: string
  }> {
    const refundOrder = await this.prisma.transactionOrder.findUnique({
      where: { orderNo: refundNo },
    })
    if (!refundOrder) {
      throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '退款订单不存在'))
    }

    if (refundOrder.status === TransactionStatus.SUCCESS || refundOrder.status === TransactionStatus.FAILED) {
      return {
        refundNo,
        status: refundOrder.status,
      }
    }

    // PENDING 表示渠道退款尚未发起，不应查询渠道；只有 PROCESSING 才需要主动查询
    if (refundOrder.status === TransactionStatus.PENDING) {
      return {
        refundNo,
        status: refundOrder.status,
        message: '退款处理中',
      }
    }

    const channelConfig = await this.channelRegistry.getEnabledConfig(refundOrder.channel || 'mock')

    const queryResult = await this.channelBridge.queryRefund(
      refundOrder.channel || 'mock',
      refundOrder.channelOrderNo || refundNo,
      channelConfig.config,
    )

    // 更新退款状态（条件迁移：queryRefund 无调用方锁，防止与回调路径并发双写）
    const newStatus = queryResult.status === 'SUCCESS'
      ? TransactionStatus.SUCCESS
      : queryResult.status === 'FAILED'
        ? TransactionStatus.FAILED
        : TransactionStatus.PENDING

    if (newStatus !== refundOrder.status) {
      const moved = await this.prisma.transactionOrder.updateMany({
        where: {
          id: refundOrder.id,
          status: { in: [TransactionStatus.PENDING, TransactionStatus.PROCESSING] },
        },
        data: {
          status: newStatus,
          completedAt: newStatus === TransactionStatus.SUCCESS || newStatus === TransactionStatus.FAILED
            ? new Date()
            : undefined,
        },
      })

      // 只有抢到状态迁移权的一方处理资金退回（processRefundSuccess 内部再有
      // 账本键幂等兜底，双保险防并发双倍扣回）
      if (moved.count === 1 && newStatus === TransactionStatus.SUCCESS && refundOrder.relatedOrderNo) {
        await this.processRefundSuccess(refundNo)
      }
    }

    return {
      refundNo,
      status: queryResult.status,
      message: queryResult.message,
    }
  }

  /**
   * 处理退款回调
   */
  async handleRefundCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const channel = this.channelRegistry.getChannel(channelCode)
    const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
    const result = channel.parseRefundCallback(rawBody, headers, channelConfig.config)

    return this.redis.withLock(`refund:callback:${result.refundNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      // 事务内只做条件状态迁移；资金退回统一走 processRefundSuccess
      //（独立锁 + 账本键幂等 + 双腿分录）。此前回调路径自带一份扣款逻辑，
      // 与 processRefundSuccess 分属两把不同的锁、各自检查幂等，同步成功与
      // 异步回调并发时可能同时通过幂等检查造成双倍扣回
      const shouldProcess = await this.prisma.$transaction(async (tx) => {
        // 查找退款订单
        const refundOrder = await tx.transactionOrder.findUnique({
          where: { orderNo: result.refundNo },
        })
        if (!refundOrder) {
          throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '退款订单不存在'))
        }

        // 幂等检查
        if (refundOrder.status === TransactionStatus.SUCCESS || refundOrder.status === TransactionStatus.FAILED) {
          return false
        }

        // 验证渠道
        if (refundOrder.channel !== channelCode) {
          throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_MISMATCH))
        }

        // 更新退款状态（条件迁移，防与 queryRefund/同步成功路径并发）
        // channelOrderNo 不用回调返回的纯 trade_no 覆盖已有值：
        // refund() 存的是 ${trade_no}:${out_request_no} 复合格式，queryRefund 依赖它解析。
        // 回调只返回纯 trade_no，覆盖后 queryRefund 会因格式非法永久失效。
        const newStatus = result.status === 'SUCCESS' ? TransactionStatus.SUCCESS : TransactionStatus.FAILED
        const moved = await tx.transactionOrder.updateMany({
          where: {
            id: refundOrder.id,
            status: { in: [TransactionStatus.PENDING, TransactionStatus.PROCESSING] },
          },
          data: {
            status: newStatus,
            channelOrderNo: refundOrder.channelOrderNo || result.channelRefundNo,
            completedAt: new Date(),
          },
        })

        // 抢到迁移权且回调成功才处理资金；count=0 说明状态已被其他路径处理
        return moved.count === 1 && result.status === 'SUCCESS'
      })

      if (shouldProcess) {
        await this.processRefundSuccess(result.refundNo)
      }

      return channel.buildRefundCallbackSuccess()
    })
  }

  /**
   * 退款成功后处理资金退回（三条路径的唯一入口：同步成功/查询确认/异步回调）
   *
   * 幂等三重防护：refund:process:{refundNo} 分布式锁 → 账本键（退款单 id + CREDIT）
   * 互见 → PROCESSING 条件状态迁移。
   *
   * 资金语义（渠道原路退回）：商户余额扣回退款额，等额资金由渠道从 CHANNEL_FUND
   * 退回付款方原卡（平台外），故复式分录为 借 USER:商户 / 贷 CHANNEL_FUND。
   * 此前只有商户单边扣款账本——资金去向不明、对账 assets_balance 必然告警。
   */
  private async processRefundSuccess(refundNo: string): Promise<void> {
    await this.redis.withLock(`refund:process:${refundNo}`, REDIS_LOCK_TTL_SECONDS, async () => {
      // 查找退款订单
      const refundOrder = await this.prisma.transactionOrder.findUnique({
        where: { orderNo: refundNo },
        select: { id: true, status: true, relatedOrderNo: true, amount: true },
      })
      if (!refundOrder) {
        this.logger.error(`退款成功但退款订单不存在: ${refundNo}`)
        return
      }

      // 幂等检查：以退款单 id 为账本键（三条路径统一），避免重复扣款
      const existingLedger = await this.prisma.accountLedger.findFirst({
        where: { transactionId: refundOrder.id, direction: Direction.CREDIT },
      })
      if (existingLedger) {
        this.logger.warn(`退款 ${refundNo} 已处理过资金退回，跳过重复扣款`)
        return
      }

      // 原支付订单：toUserId=收款方（商户，扣回退款），fromUserId=付款方（原路退回，记账单）
      const originalOrder = refundOrder.relatedOrderNo
        ? await this.prisma.transactionOrder.findUnique({
            where: { orderNo: refundOrder.relatedOrderNo },
            select: { fromUserId: true, toUserId: true, relatedOrderNo: true },
          })
        : null
      const merchantUserId = originalOrder?.toUserId
      if (!merchantUserId) {
        this.logger.error(`退款 ${refundNo} 缺少原订单或收款方，无法处理资金退回`)
        return
      }

      const account = await this.prisma.account.findUnique({
        where: { userId: merchantUserId },
      })
      if (!account) {
        this.logger.error(`退款成功但商户账户不存在: ${merchantUserId}`)
        return
      }

      await this.prisma.$transaction(async (tx) => {
        // 如果状态还是 PROCESSING，条件迁移为 SUCCESS
        if (refundOrder.status === TransactionStatus.PROCESSING) {
          await tx.transactionOrder.updateMany({
            where: { id: refundOrder.id, status: TransactionStatus.PROCESSING },
            data: { status: TransactionStatus.SUCCESS, completedAt: new Date() },
          })
        }

        // 条件更新防负余额：可用余额不足时记录 HIGH 风险事件，交人工处理
        const deductResult = await tx.account.updateMany({
          where: { id: account.id, availableBalance: { gte: refundOrder.amount } },
          data: {
            availableBalance: { decrement: refundOrder.amount },
            totalBalance: { decrement: refundOrder.amount },
          },
        })

        if (deductResult.count === 0) {
          await tx.riskEvent.create({
            data: {
              userId: merchantUserId,
              type: RiskEventType.LARGE_PAYMENT,
              level: RiskLevel.HIGH,
              description: `退款 ${refundNo} 扣回失败：可用余额不足 ${fenToYuan(refundOrder.amount)} 元，需人工调账`,
            },
          })
          this.logger.error(`退款 ${refundNo} 扣回失败：账户 ${account.id} 可用余额不足`)
          return
        }

        const refreshed = await tx.account.findUnique({ where: { id: account.id } })
        await tx.accountLedger.create({
          data: {
            accountId: account.id,
            transactionId: refundOrder.id,
            type: LedgerType.REFUND,
            amount: refundOrder.amount,
            balanceBefore: refreshed!.availableBalance + refundOrder.amount,
            balanceAfter: refreshed!.availableBalance,
            direction: Direction.CREDIT,
            remark: `退款 ${refundNo}（原订单 ${refundOrder.relatedOrderNo}）`,
          },
        })

        // 复式记账双腿：商户承担退款（借），渠道原路退回付款方（贷）
        await this.journalService.createEntries(tx, [
          {
            journalId: generateOrderNo('J'),
            accountCode: `USER:${merchantUserId}`,
            debit: refundOrder.amount,
            memo: `退款 ${refundNo}（商户承担，原订单 ${refundOrder.relatedOrderNo}）`,
          },
          {
            journalId: generateOrderNo('J'),
            accountCode: 'CHANNEL_FUND',
            credit: refundOrder.amount,
            memo: `退款 ${refundNo}（渠道原路退回付款方）`,
          },
        ])

        // 账单（I1 三表联动）：商户 EXPENSE；付款方 INCOME（原路退回，记录可见）
        const parties = await tx.user.findMany({
          where: {
            id: {
              in: [merchantUserId, originalOrder.fromUserId].filter(
                (id): id is string => Boolean(id),
              ),
            },
          },
          select: { id: true, nickname: true },
        })
        const nicknameOf = (id: string) => parties.find((u) => u.id === id)?.nickname || ''
        await tx.bill.create({
          data: {
            userId: merchantUserId,
            transactionId: refundOrder.id,
            type: BillType.REFUND,
            direction: BillDirection.EXPENSE,
            amount: refundOrder.amount,
            counterparty: nicknameOf(originalOrder.fromUserId || ''),
            remark: `退款 ${refundNo}（原订单 ${refundOrder.relatedOrderNo}）`,
          },
        })
        if (originalOrder.fromUserId && originalOrder.fromUserId !== merchantUserId) {
          await tx.bill.create({
            data: {
              userId: originalOrder.fromUserId,
              transactionId: refundOrder.id,
              type: BillType.REFUND,
              direction: BillDirection.INCOME,
              amount: refundOrder.amount,
              counterparty: nicknameOf(merchantUserId),
              remark: `退款 ${refundNo}（原路退回，原订单 ${refundOrder.relatedOrderNo}）`,
            },
          })
        }

        // 同步更新对应的 paymentOrder.refundAmount（原支付单 -> 商户订单）
        if (originalOrder.relatedOrderNo) {
          const paymentOrder = await tx.paymentOrder.findUnique({
            where: { orderNo: originalOrder.relatedOrderNo },
            select: { id: true, amount: true, refundAmount: true },
          })
          if (paymentOrder) {
            const newRefundAmount = (paymentOrder.refundAmount || 0) + refundOrder.amount
            await tx.paymentOrder.update({
              where: { id: paymentOrder.id },
              data: {
                refundAmount: newRefundAmount,
                refundedAt: new Date(),
                status: newRefundAmount >= paymentOrder.amount
                  ? PaymentOrderStatus.REFUNDED
                  : PaymentOrderStatus.PAID,
              },
            })
          }
        }
      })
      // 退款成功后记录风控频率（不阻塞业务）
      if (merchantUserId) {
        this.riskEngine.recordTransaction({
          userId: merchantUserId,
          type: 'REFUND',
          amount: refundOrder.amount,
        }).catch((err) => {
          this.logger.warn(`recordTransaction(REFUND) 失败: ${err?.message || err}`)
        })
      }
    })
  }

  /**
   * 获取退款统计信息
   */
  async getRefundStats(userId: string): Promise<{
    totalRefunds: number
    totalRefundAmount: number
    pendingRefunds: number
  }> {
    const [totalRefunds, amountResult, pendingRefunds] = await Promise.all([
      this.prisma.transactionOrder.count({
        where: {
          type: 'REFUND' as any,
          toUserId: userId,
        },
      }),
      this.prisma.transactionOrder.aggregate({
        _sum: { amount: true },
        where: {
          type: 'REFUND' as any,
          toUserId: userId,
          status: TransactionStatus.SUCCESS,
        },
      }),
      this.prisma.transactionOrder.count({
        where: {
          type: 'REFUND' as any,
          toUserId: userId,
          status: TransactionStatus.PENDING,
        },
      }),
    ])

    return {
      totalRefunds,
      totalRefundAmount: amountResult._sum.amount || 0,
      pendingRefunds,
    }
  }
}
