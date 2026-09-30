import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PaymentOrderStatus } from '../common/enums'
import { RedisService } from '../redis/redis.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { PaymentChannelBridge } from './payment-channel.bridge'
import { RefundRequest, RefundResponse, ChannelConfig } from './payment-channel.interface'
import { generateOrderNo } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {buildLockKey, REDIS_LOCK_TTL_SECONDS} from '../common/constants'

/**
 * 统一退款服务（合规聚合模式）
 *
 * 退款单内嵌于收单订单（PaymentOrder.refundNo/refundStatus/refundChannelNo/
 * refundPendingAmount），退款由持牌通道原路退回付款方，平台不经手资金、不设退款流水表。
 *
 * 提供：
 * - 统一退款接口（自动路由到对应渠道）
 * - 退款状态查询
 * - 退款回调处理
 * - 退款状态跟踪
 */

// 退款状态（内嵌于 payment_orders.refund_status）
export const RefundStatus = {
  PENDING: 'PENDING', // 已受理，待调渠道
  PROCESSING: 'PROCESSING', // 已调渠道，等待结果
  SUCCESS: 'SUCCESS', // 退款成功（原路退回）
  FAILED: 'FAILED', // 退款失败
} as const

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly channelBridge: PaymentChannelBridge,
    private readonly riskEngine: RiskEngineService,
  ) {}

  /**
   * 发起退款
   *
   * @param orderNo 原支付订单号（PaymentOrder.orderNo）
   * @param amount  退款金额（分）
   * @param reason  退款原因
   * @param idempotencyKey 幂等键（同一订单同一键返回原退款结果）
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

    return this.redis.withLock(buildLockKey('refund:create', orderNo), REDIS_LOCK_TTL_SECONDS, async () => {
      // 原支付订单为收单订单（聚合模式无平台内资金流水）
      const order = await this.prisma.paymentOrder.findUnique({
        where: { orderNo },
      })
      if (!order) {
        throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '原支付订单不存在'))
      }

      // 检查订单状态
      if (order.status !== PaymentOrderStatus.PAID) {
        throw new BadRequestException(kbError(KBErrorCodes.ORDER_NOT_REFUNDABLE, '订单状态不可退款'))
      }

      // 退款金额校验：可退 = 订单金额 - 已退累计（refundAmount 由退款成功路径原子累加）
      const refundableAmount = order.amount - (order.refundAmount || 0)
      if (amount > refundableAmount) {
        throw new BadRequestException(kbError(KBErrorCodes.REFUND_AMOUNT_EXCEEDED))
      }

      // 幂等：同一订单同一幂等键返回原退款结果
      if (idempotencyKey && order.refundIdempotencyKey === idempotencyKey && order.refundNo) {
        return {
          refundNo: order.refundNo,
          channelRefundNo: order.refundChannelNo || '',
          status: order.refundStatus || RefundStatus.PENDING,
        }
      }

      // 防并发重复退款：退款处理中（PROCESSING）不可再发起
      if (order.refundStatus === RefundStatus.PROCESSING) {
        throw new BadRequestException(kbError(KBErrorCodes.ORDER_NOT_REFUNDABLE, '退款处理中，请勿重复发起'))
      }

      // 获取渠道配置（渠道实例由桥接层按编码解析）
      const channelConfig = await this.channelRegistry.getEnabledConfig(order.channel || 'mock')

      const refundNo = generateOrderNo('RF')

      // 退款单内嵌于收单订单：先置 PROCESSING 并记录本次退款金额，再调渠道
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          refundNo,
          refundStatus: RefundStatus.PROCESSING,
          refundReason: reason,
          refundIdempotencyKey: idempotencyKey,
          refundPendingAmount: amount,
        },
      })

      // 调用渠道退款
      const refundRequest: RefundRequest = {
        orderNo,
        refundNo,
        amount,
        reason: reason || '用户退款',
        channelOrderNo: order.channelOrderNo || orderNo,
        channelConfig: channelConfig.config,
        // 微信退款要求 amount.total=原订单支付金额，部分退款必须区分
        originalAmount: order.amount,
      }

      let refundResult: RefundResponse
      try {
        refundResult = await this.channelBridge.refund(order.channel || 'mock', refundRequest)
      } catch (error) {
        // 渠道退款失败，更新退款状态
        await this.prisma.paymentOrder.update({
          where: { id: order.id },
          data: {
            refundStatus: RefundStatus.FAILED,
            refundPendingAmount: 0,
            refundReason: `退款失败：${error instanceof Error ? error.message : '未知错误'}`,
          },
        })
        throw new BadRequestException(
          kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, `退款渠道调用失败：${error instanceof Error ? error.message : '未知错误'}`),
        )
      }

      // 更新退款单状态与渠道退款号
      const newStatus = refundResult.status === 'SUCCESS'
        ? RefundStatus.SUCCESS
        : refundResult.status === 'FAILED'
          ? RefundStatus.FAILED
          : RefundStatus.PENDING
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          refundStatus: newStatus,
          refundChannelNo: refundResult.channelRefundNo,
        },
      })

      // 如果退款直接成功，处理订单退款入账（统一入口：锁 + 状态幂等）
      if (refundResult.status === 'SUCCESS') {
        await this.processRefundSuccess(refundNo)
      }

      return {
        refundNo,
        channelRefundNo: refundResult.channelRefundNo,
        status: newStatus,
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
    const order = await this.prisma.paymentOrder.findUnique({
      where: { refundNo },
    })
    if (!order) {
      throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '退款订单不存在'))
    }

    if (order.refundStatus === RefundStatus.SUCCESS || order.refundStatus === RefundStatus.FAILED) {
      return {
        refundNo,
        status: order.refundStatus,
      }
    }

    // PENDING 表示渠道退款尚未发起，不应查询渠道；只有 PROCESSING 才需要主动查询
    if (order.refundStatus === RefundStatus.PENDING) {
      return {
        refundNo,
        status: order.refundStatus,
        message: '退款处理中',
      }
    }

    const channelConfig = await this.channelRegistry.getEnabledConfig(order.channel || 'mock')

    const queryResult = await this.channelBridge.queryRefund(
      order.channel || 'mock',
      order.refundChannelNo || refundNo,
      channelConfig.config,
    )

    // 更新退款状态（条件迁移：queryRefund 无调用方锁，防止与回调路径并发双写）
    const newStatus = queryResult.status === 'SUCCESS'
      ? RefundStatus.SUCCESS
      : queryResult.status === 'FAILED'
        ? RefundStatus.FAILED
        : RefundStatus.PENDING

    if (newStatus !== order.refundStatus) {
      const moved = await this.prisma.paymentOrder.updateMany({
        where: {
          id: order.id,
          refundStatus: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING] },
        },
        data: {
          refundStatus: newStatus,
          refundChannelNo: order.refundChannelNo || queryResult.channelRefundNo,
        },
      })

      // 只有抢到状态迁移权的一方处理退款入账（processRefundSuccess 内部再幂等兜底）
      if (moved.count === 1 && newStatus === RefundStatus.SUCCESS) {
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

    return this.redis.withLock(buildLockKey('refund:callback', result.refundNo), REDIS_LOCK_TTL_SECONDS, async () => {
      const shouldProcess = await this.prisma.$transaction(async (tx) => {
        // 查找收单订单（退款单内嵌）
        const order = await tx.paymentOrder.findUnique({
          where: { refundNo: result.refundNo },
        })
        if (!order) {
          throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND, '退款订单不存在'))
        }

        // 幂等检查
        if (order.refundStatus === RefundStatus.SUCCESS || order.refundStatus === RefundStatus.FAILED) {
          return false
        }

        // 验证渠道
        if (order.channel !== channelCode) {
          throw new BadRequestException(kbError(KBErrorCodes.CALLBACK_CHANNEL_MISMATCH))
        }

        // 更新退款状态（条件迁移，防与 queryRefund/同步成功路径并发）
        const newStatus = result.status === 'SUCCESS' ? RefundStatus.SUCCESS : RefundStatus.FAILED
        const moved = await tx.paymentOrder.updateMany({
          where: {
            id: order.id,
            refundStatus: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING] },
          },
          data: {
            refundStatus: newStatus,
            refundChannelNo: order.refundChannelNo || result.channelRefundNo,
          },
        })

        return moved.count === 1 && result.status === 'SUCCESS'
      })

      if (shouldProcess) {
        await this.processRefundSuccess(result.refundNo)
      }

      return channel.buildRefundCallbackSuccess()
    })
  }

  /**
   * 退款成功后的订单入账（三条路径的唯一入口：同步成功/查询确认/异步回调）
   *
   * 合规聚合模式：退款由持牌通道原路退回付款方，平台不经手资金。
   * 仅累加收单订单的退款金额并驱动订单状态（refundAmount 原子累加 → REFUNDED）。
   */
  private async processRefundSuccess(refundNo: string): Promise<void> {
    await this.redis.withLock(buildLockKey('refund:process', refundNo), REDIS_LOCK_TTL_SECONDS, async () => {
      const order = await this.prisma.paymentOrder.findUnique({
        where: { refundNo },
        select: {
          id: true,
          amount: true,
          refundAmount: true,
          refundStatus: true,
          refundPendingAmount: true,
          payerId: true,
        },
      })
      if (!order) {
        this.logger.error(`退款成功但订单不存在: ${refundNo}`)
        return
      }

      // 幂等：状态已是 SUCCESS 说明已处理
      if (order.refundStatus === RefundStatus.SUCCESS) {
        this.logger.warn(`退款 ${refundNo} 已处理过，跳过重复入账`)
        return
      }

      const refundAmount = order.refundPendingAmount || 0
      if (refundAmount <= 0) {
        this.logger.error(`退款 ${refundNo} 缺少退款金额，无法入账`)
        return
      }

      await this.prisma.$transaction(async (tx) => {
        const newRefundAmount = (order.refundAmount || 0) + refundAmount
        await tx.paymentOrder.update({
          where: { id: order.id },
          data: {
            refundAmount: newRefundAmount,
            refundedAt: new Date(),
            refundStatus: RefundStatus.SUCCESS,
            refundPendingAmount: 0,
            status: newRefundAmount >= order.amount
              ? PaymentOrderStatus.REFUNDED
              : PaymentOrderStatus.PAID,
          },
        })
      })

      // 退款成功后记录风控频率（不阻塞业务）
      if (order.payerId) {
        this.riskEngine.recordTransaction({
          userId: order.payerId,
          type: 'REFUND',
          amount: refundAmount,
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
      this.prisma.paymentOrder.count({
        where: { payerId: userId, refundAmount: { gt: 0 } },
      }),
      this.prisma.paymentOrder.aggregate({
        where: { payerId: userId },
        _sum: { refundAmount: true },
      }),
      this.prisma.paymentOrder.count({
        where: {
          payerId: userId,
          refundStatus: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING] },
        },
      }),
    ])

    return {
      totalRefunds,
      totalRefundAmount: amountResult._sum.refundAmount || 0,
      pendingRefunds,
    }
  }
}
