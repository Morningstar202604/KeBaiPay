import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { RefundService } from '../payment-channels/refund.service'
import { CashierService } from '../cashier/cashier.service'
import { PaymentOrderStatus } from '../common/enums'
import { KBErrorCodes, kbError } from '../common/error-codes'
import type { ChannelConfig } from '../payment-channels/payment-channel.interface'
import { buildLockKey } from '../common/constants'

/**
 * Webhook 处理服务
 *
 * 合规聚合模式（资金不过平台）：
 * - recharge 回调：收单订单（PaymentOrder）支付结果回调 —— 校验渠道/金额后
 *   将订单置为 PAID 并通知商户，不产生任何平台账户/账本记录
 * - refund 回调：退款结果回调（保留）
 * - payout 回调：已下线（代付/提现为资金池功能，随资金池模块一并移除）
 *
 * 功能：
 * - 支付渠道回调签名验证
 * - 幂等性检查
 * - 统一错误处理
 * - 回调日志记录
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly refundService: RefundService,
    private readonly cashierService: CashierService,
  ) {}

  /**
   * 处理收单支付回调（原充值回调，资金池下线后语义改为收单订单）
   */
  async handleRechargeCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    // 锁 key 使用 rawBody hash：微信 V3 回调外层无 out_trade_no（需解密），
    // 改用 hash 保证同一回调内容多次重试时锁同一把，避免锁 key 退化为 unknown
    const orderNo = this.extractOrderNo(rawBody, channelCode)
    const lockKey = buildLockKey('webhook:recharge', `${channelCode}:${orderNo}`)

    const startTime = Date.now()
    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 验证签名 —— 必须先于幂等检查（纵深防御）：
      //    若幂等命中直接返回 200，伪造回调就能借"订单已终态"绕过验签探测；
      //    验签先行保证任何未通过签名校验的请求一律 400，无论订单状态如何。
      await this.verifySignature(channelCode, rawBody, headers, 'recharge')

      // 2. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'recharge')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`收单支付回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      try {
        // 3. 解析回调（渠道实现内含验签）
        const channel = this.channelRegistry.getChannel(channelCode)
        const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
        const result = channel.parseRechargeCallback(rawBody, headers, channelConfig.config)

        // 4. 处理回调：更新收单订单状态（资金不过平台，无账户/账本写入）
        const paidOrder = await this.redis.withLock(
          buildLockKey('cashier:pay', result.orderNo),
          30,
          async () => {
            const order = await this.prisma.paymentOrder.findUnique({
              where: { orderNo: result.orderNo },
            })
            if (!order) {
              throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '收单订单不存在'))
            }
            // 终态订单幂等返回，防止乱序回调重复处理
            if (
              order.status === PaymentOrderStatus.PAID ||
              order.status === PaymentOrderStatus.REFUNDED ||
              order.status === PaymentOrderStatus.CLOSED
            ) {
              return order
            }
            if (order.status !== PaymentOrderStatus.PENDING) {
              throw new BadRequestException(kbError(KBErrorCodes.ORDER_STATUS_CHANGED))
            }
            // 安全防护：回调渠道必须与订单创建时的渠道一致，防止用 A 渠道密钥伪造对 B 渠道订单的回调
            if (order.channel !== channelCode) {
              throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_MISMATCH))
            }
            // 金额一致性强制核对：渠道实付金额与订单金额不一致（改价/组合支付/异常）
            // 一律拒绝，防止少收多入。fail-closed：回调未携带金额同样拒绝。
            if (result.amount !== order.amount) {
              this.logger.error(
                `收单回调金额不一致：订单 ${order.orderNo} 订单金额=${order.amount} 实付金额=${result.amount}，拒绝确认支付`,
              )
              throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_AMOUNT_MISMATCH))
            }
            if (result.status === 'FAILED') {
              // 渠道明确失败：保持 PENDING（不标记终态），等待超时关单或人工介入
              this.logger.warn(`收单回调返回失败状态：订单 ${order.orderNo}，保持 PENDING`)
              return order
            }
            // channelOrderNo 校验：正常情况下必须匹配；兜底补录（创建支付链接后、持久化前崩溃）
            const channelOrderNoMissing = !order.channelOrderNo
            if (!channelOrderNoMissing && order.channelOrderNo !== result.channelOrderNo) {
              throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_ORDER_NO_MISMATCH))
            }
            return this.prisma.paymentOrder.update({
              where: { id: order.id },
              data: {
                status: PaymentOrderStatus.PAID,
                paidAt: new Date(),
                ...(result.channelOrderNo
                  ? { channelOrderNo: result.channelOrderNo }
                  : {}),
              },
            })
          },
        )

        // 5. 事务提交后异步通知商户，不阻塞回调应答；失败不影响订单状态
        if (paidOrder.callbackUrl) {
          setImmediate(() => {
            this.cashierService.notifyMerchant({
              id: paidOrder.id,
              orderNo: paidOrder.orderNo,
              merchantOrderNo: paidOrder.merchantOrderNo,
              amount: paidOrder.amount,
              status: paidOrder.status as PaymentOrderStatus,
              paidAt: paidOrder.paidAt,
              callbackUrl: paidOrder.callbackUrl,
              appId: paidOrder.appId,
            }).catch((err) => {
              this.logger.error(
                `收单订单 ${paidOrder.orderNo} 回调通知异常: ${err?.message || err}`,
              )
            })
          })
        }

        // 6. 记录已处理 + 回调日志（落库）
        await this.redis.set(idempotencyKey, '1', 86400) // 24 小时过期
        await this.logCallback(
          channelCode,
          'recharge',
          rawBody,
          'SUCCESS',
          null,
          Date.now() - startTime,
        )

        return this.getSuccessResponse(channelCode)
      } catch (err) {
        // 处理失败也要落库记录，便于审计追溯
        await this.logCallback(
          channelCode,
          'recharge',
          rawBody,
          'PROCESS_ERROR',
          err instanceof Error ? err.message : String(err),
          Date.now() - startTime,
        )
        throw err
      }
    })
  }

  /**
   * 处理退款回调
   */
  async handleRefundCallback(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const refundNo = this.extractRefundNo(rawBody, channelCode)
    const lockKey = buildLockKey('webhook:refund', `${channelCode}:${refundNo}`)

    const startTime = Date.now()
    return this.redis.withLock(lockKey, 30, async () => {
      // 1. 验证签名 —— 先于幂等检查（与支付回调同理，纵深防御）
      await this.verifySignature(channelCode, rawBody, headers, 'refund')

      // 2. 幂等性检查
      const idempotencyKey = this.generateIdempotencyKey(channelCode, rawBody, 'refund')
      const processed = await this.redis.get(idempotencyKey)
      if (processed) {
        this.logger.warn(`退款回调已处理: ${channelCode}`)
        return this.getSuccessResponse(channelCode)
      }

      try {
        // 3. 处理回调
        const result = await this.refundService.handleRefundCallback(
          channelCode,
          rawBody,
          headers,
        )

        // 4. 记录已处理
        await this.redis.set(idempotencyKey, '1', 86400)

        // 5. 记录回调日志（落库）
        await this.logCallback(
          channelCode,
          'refund',
          rawBody,
          'SUCCESS',
          null,
          Date.now() - startTime,
        )

        return result
      } catch (err) {
        await this.logCallback(
          channelCode,
          'refund',
          rawBody,
          'PROCESS_ERROR',
          err instanceof Error ? err.message : String(err),
          Date.now() - startTime,
        )
        throw err
      }
    })
  }

  /**
   * 验证渠道签名
   * 签名验证失败或异常一律拒绝处理，防止伪造回调。
   * 验签为强制项：渠道必须实现 verifyWebhookSignature，否则直接拒绝该渠道回调
   *（防止未来新增渠道漏写验签即上线的"裸奔"缺口）。
   */
  private async verifySignature(
    channelCode: string,
    rawBody: string,
    headers: Record<string, string>,
    callbackType: 'recharge' | 'refund',
  ): Promise<void> {
    const channelConfig = await this.channelRegistry.getEnabledConfig(channelCode)
    const channel = this.channelRegistry.getChannel(channelCode)

    const verifyFn = (
      channel as {
        verifyWebhookSignature?: (raw: string, hdr: Record<string, string>, cfg: ChannelConfig) => boolean
      }
    ).verifyWebhookSignature

    if (typeof verifyFn !== 'function') {
      // 强制验签：未实现验签方法的渠道不允许接入回调
      this.logger.error(`${channelCode} 未实现 verifyWebhookSignature，拒绝处理 ${callbackType} 回调`)
      await this.logCallback(
        channelCode,
        callbackType,
        rawBody,
        'SIGNATURE_ERROR',
        'channel does not implement signature verification',
        0,
      )
      throw new BadRequestException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, `${channelCode} 回调验签不可用`),
      )
    }

    let isValid = false
    try {
      isValid = verifyFn.call(channel, rawBody, headers, channelConfig.config)
    } catch (err) {
      // 验签过程本身抛错视为验签失败，拒绝处理
      this.logger.error(`${channelCode} ${callbackType} 验签异常: ${err}`)
      await this.logCallback(
        channelCode,
        callbackType,
        rawBody,
        'SIGNATURE_ERROR',
        err instanceof Error ? err.message : String(err),
        0,
      )
      throw new BadRequestException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, `${channelCode} 回调验签异常`),
      )
    }
    if (!isValid) {
      this.logger.error(`${channelCode} ${callbackType} 回调签名验证失败`)
      await this.logCallback(
        channelCode,
        callbackType,
        rawBody,
        'SIGNATURE_FAILED',
        'signature verification failed',
        0,
      )
      throw new BadRequestException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, `${channelCode} 回调签名验证失败`),
      )
    }
  }

  /**
   * 从回调体中提取订单号（用于锁 key 隔离）
   *
   * 微信 V3 回调外层是加密的 resource.ciphertext，无法在解密前提取 out_trade_no。
   * 改用 rawBody 的 SHA256 前 16 位作为锁 key 后缀，保证同一回调内容多次重试时
   * 锁同一把，不同回调锁不同把。比之前退化为 'unknown' 让所有并发回调串行化更优。
   */
  private extractOrderNo(rawBody: string, channelCode: string): string {
    // 微信 V3 回调外层无明文订单号，用 hash 兜底
    if (channelCode === 'wechat') {
      const hash = createHash('sha256').update(rawBody).digest('hex')
      return `hash:${hash.slice(0, 16)}`
    }

    try {
      if (channelCode === 'alipay') {
        // 支付宝回调是 form-urlencoded
        const params = new URLSearchParams(rawBody)
        return params.get('out_trade_no') || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
      }
      const body = JSON.parse(rawBody)
      return body.orderNo || body.out_trade_no || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
    } catch {
      // 解析失败用 hash 兜底，避免退化为 'unknown' 导致并发回调串行化
      return `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
    }
  }

  /**
   * 从退款回调体中提取退款单号（用于锁 key 隔离）
   *
   * 与 extractOrderNo 同理：微信回调用 hash 兜底。
   */
  private extractRefundNo(rawBody: string, channelCode: string): string {
    if (channelCode === 'wechat') {
      const hash = createHash('sha256').update(rawBody).digest('hex')
      return `hash:${hash.slice(0, 16)}`
    }

    try {
      if (channelCode === 'alipay') {
        const params = new URLSearchParams(rawBody)
        return params.get('out_request_no') || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
      }
      const body = JSON.parse(rawBody)
      return body.refundNo || body.out_refund_no || `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
    } catch {
      return `hash:${createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`
    }
  }

  /**
   * 生成幂等键
   */
  private generateIdempotencyKey(
    channelCode: string,
    rawBody: string,
    callbackType: string,
  ): string {
    // 使用渠道+类型+body hash 作为幂等键
    const hash = createHash('sha256').update(rawBody).digest('hex')
    return `webhook:${channelCode}:${callbackType}:${hash}`
  }

  /**
   * 获取成功响应
   */
  private getSuccessResponse(channelCode: string): string {
    switch (channelCode) {
      case 'wechat':
        return JSON.stringify({ code: 'SUCCESS', message: '成功' })
      case 'alipay':
        return 'success'
      default:
        return 'SUCCESS'
    }
  }

  /**
   * 记录回调日志（落库到 webhook_logs 表）
   *
   * 所有 webhook 入站均落库，包含成功/失败两种状态，用于审计追溯与故障排查。
   * 落库失败不影响主流程，仅记录错误日志。
   */
  private async logCallback(
    channelCode: string,
    callbackType: string,
    rawBody: string,
    status: string,
    errorMessage: string | null,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.prisma.webhookLog.create({
        data: {
          channelCode,
          callbackType,
          status,
          rawBody,
          errorMessage,
          durationMs,
        },
      })
    } catch (error) {
      // 落库失败不能影响主流程，仅记录错误日志
      this.logger.error(
        `记录回调日志失败: ${channelCode} ${callbackType} ${status} - ${error}`,
      )
    }
  }
}
