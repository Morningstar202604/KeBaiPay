import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import {
  MerchantStatus,
  PaymentOrderStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { fenToYuan, generateOrderNo, generatePaymentNo, isCallbackUrlSafe, yuanToFen } from '../common/helpers'
import { kbError, KBErrorCodes } from '../common/error-codes'
import {
  buildLockKey,
  MAX_ORDER_EXPIRY_MS,
  ORDER_EXPIRY_MS,
  REDIS_LOCK_TTL_SECONDS,
} from '../common/constants'
import { MerchantApp } from './open-api.types'
import { RefundService } from '../payment-channels/refund.service'

@Injectable()
export class OpenApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly riskEngine: RiskEngineService,
    private readonly refundService: RefundService,
  ) {}

  private getCashierBaseUrl(): string {
    return (
      this.configService.get<string>('CASHIER_BASE_URL') ||
      'http://localhost:3001'
    )
  }

  async createOrder(
    app: MerchantApp,
    dto: {
      merchantOrderNo: string
      amount: number
      subject: string
      body?: string
      callbackUrl?: string
      expiredAt?: string
    },
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: app.merchantId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw new BadRequestException(kbError(KBErrorCodes.MERCHANT_NOT_APPROVED))
    }

    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.ORDER_AMOUNT_INVALID))
    }
    const amount = yuanToFen(dto.amount)

    // 幂等：命中已有订单直接返回，不抛错
    const existing = await this.prisma.paymentOrder.findFirst({
      where: {
        merchantId: merchant.id,
        merchantOrderNo: dto.merchantOrderNo,
      },
    })
    if (existing) {
      // 跨 appId 信息泄露防护：仅同一 app 可幂等返回
      if (existing.appId !== app.appId) {
        throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订单'))
      }
      return this.formatOrderResponse({ ...existing, status: existing.status as PaymentOrderStatus })
    }

    const expiredAt = dto.expiredAt
      ? new Date(dto.expiredAt)
      : new Date(Date.now() + ORDER_EXPIRY_MS)
    if (isNaN(expiredAt.getTime())) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '过期时间格式无效'))
    }
    if (expiredAt <= new Date()) {
      throw new BadRequestException(kbError(KBErrorCodes.EXPIRED_TIME_INVALID))
    }
    if (expiredAt > new Date(Date.now() + MAX_ORDER_EXPIRY_MS)) {
      throw new BadRequestException(kbError(KBErrorCodes.ORDER_EXPIRED_TIME_TOO_LATE))
    }

    if (dto.callbackUrl) {
      await this.validateCallbackUrl(dto.callbackUrl)
    }

    const orderNo = generatePaymentNo()

    try {
      const order = await this.prisma.paymentOrder.create({
        data: {
          merchantId: merchant.id,
          appId: app.appId,
          merchantOrderNo: dto.merchantOrderNo,
          orderNo,
          amount,
          subject: dto.subject,
          body: dto.body,
          callbackUrl: dto.callbackUrl,
          expiredAt,
        },
      })

      return this.formatOrderResponse({ ...order, status: order.status as PaymentOrderStatus })
    } catch (e) {
      // 并发场景下唯一约束冲突：查回原订单幂等返回
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
        if (existed) return this.formatOrderResponse({ ...existed, status: existed.status as PaymentOrderStatus })
      }
      throw e
    }
  }

  async getOrder(app: MerchantApp, orderNo: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
    if (order.appId !== app.appId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查询该订单'))
    }

    return {
      ...order,
      amountYuan: fenToYuan(order.amount),
      feeYuan: fenToYuan(order.fee),
      refundAmountYuan: fenToYuan(order.refundAmount),
    }
  }

  /**
   * 申请退款（合规聚合模式：统一走 RefundService，退款由持牌通道原路退回）
   */
  async refund(
    app: MerchantApp,
    dto: {
      orderNo: string
      amount?: number
      reason?: string
      idempotencyKey?: string
    },
  ) {
    // 归属校验：商户只能退自己的订单
    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo: dto.orderNo },
    })
    if (!order) throw new NotFoundException(kbError(KBErrorCodes.ORDER_NOT_FOUND))
    if (order.appId !== app.appId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该订单'))
    }

    const refundAmount = dto.amount ? yuanToFen(dto.amount) : undefined
    const result = await this.refundService.createRefund(
      dto.orderNo,
      refundAmount ?? 0,
      dto.reason,
      dto.idempotencyKey,
    )

    // 全退时透传服务端计算金额（amount 未传）：重查订单得到实际退款额
    let finalAmountFen = refundAmount
    if (finalAmountFen === undefined || finalAmountFen === 0) {
      const updated = await this.prisma.paymentOrder.findUnique({
        where: { orderNo: dto.orderNo },
        select: { refundAmount: true },
      })
      finalAmountFen = updated?.refundAmount || 0
    }

    return {
      refundNo: result.refundNo,
      channelRefundNo: result.channelRefundNo,
      status: result.status,
      refundAmountYuan: fenToYuan(finalAmountFen),
      message: result.message,
    }
  }

  // 收单统计（合规聚合模式：原「余额查询」下线，平台无商户余额）
  async balance(app: MerchantApp) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: app.merchantId },
    })
    if (!merchant) throw new NotFoundException(kbError(KBErrorCodes.MERCHANT_NOT_FOUND))

    const [paidAgg, refundAgg] = await Promise.all([
      this.prisma.paymentOrder.aggregate({
        where: { merchantId: merchant.id, status: PaymentOrderStatus.PAID },
        _sum: { amount: true, fee: true },
        _count: { id: true },
      }),
      this.prisma.paymentOrder.aggregate({
        where: { merchantId: merchant.id, refundAmount: { gt: 0 } },
        _sum: { refundAmount: true },
      }),
    ])

    const totalAmount = paidAgg._sum.amount || 0
    const totalFee = paidAgg._sum.fee || 0
    const totalRefund = refundAgg._sum.refundAmount || 0

    return {
      merchantNo: merchant.merchantNo,
      totalAmountYuan: fenToYuan(totalAmount),
      totalFeeYuan: fenToYuan(totalFee),
      totalRefundYuan: fenToYuan(totalRefund),
      settledAmountYuan: fenToYuan(totalAmount - totalFee - totalRefund),
      paidCount: paidAgg._count.id || 0,
    }
  }

  private formatOrderResponse(order: {
    orderNo: string
    amount: number
    status: PaymentOrderStatus
    expiredAt: Date | null
  }) {
    return {
      orderNo: order.orderNo,
      cashierUrl: `${this.getCashierBaseUrl()}/#cashier?orderNo=${order.orderNo}`,
      amountYuan: fenToYuan(order.amount),
      status: order.status,
      expiredAt: order.expiredAt,
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
}
