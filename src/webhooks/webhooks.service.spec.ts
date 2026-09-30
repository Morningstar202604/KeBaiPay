import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { WebhooksService } from './webhooks.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RedisService } from '../redis/redis.service.js'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry.js'
import { RefundService } from '../payment-channels/refund.service.js'
import { CashierService } from '../cashier/cashier.service.js'

type PrismaMock = {
  webhookLog: { create: jest.Mock }
  paymentOrder: { findUnique: jest.Mock; update: jest.Mock }
}
type RedisMock = {
  withLock: jest.Mock
  get: jest.Mock
  set: jest.Mock
}
type ChannelRegistryMock = {
  getChannel: jest.Mock
  getEnabledConfig: jest.Mock
}
type RefundMock = { handleRefundCallback: jest.Mock }
type CashierMock = { notifyMerchant: jest.Mock }

// 收单订单（PaymentOrder）字段子集，足够驱动 webhooks 判定逻辑
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNo: 'O1',
    merchantOrderNo: 'M1',
    amount: 100,
    status: 'PENDING',
    channel: 'alipay',
    channelOrderNo: 'CH1',
    callbackUrl: null,
    paidAt: null,
    appId: null,
    ...overrides,
  }
}

describe('WebhooksService', () => {
  let service: WebhooksService
  let prisma: PrismaMock
  let redis: RedisMock
  let channelRegistry: ChannelRegistryMock
  let refund: RefundMock
  let cashier: CashierMock

  beforeEach(async () => {
    prisma = {
      webhookLog: { create: jest.fn().mockResolvedValue(undefined) },
      paymentOrder: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    }
    redis = {
      // 锁直接执行回调，方便测试业务逻辑（外层 recharge 锁 + 内层 cashier:pay 锁）
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    }
    channelRegistry = {
      // 渠道默认实现验签 + 收单回调解析
      getChannel: jest.fn().mockReturnValue({
        verifyWebhookSignature: jest.fn().mockReturnValue(true),
        parseRechargeCallback: jest.fn().mockReturnValue({
          orderNo: 'O1',
          amount: 100,
          status: 'SUCCESS',
          channelOrderNo: 'CH1',
        }),
      }),
      getEnabledConfig: jest.fn().mockResolvedValue({ config: {} }),
    }
    refund = { handleRefundCallback: jest.fn().mockResolvedValue('REFUND_OK') }
    cashier = { notifyMerchant: jest.fn().mockResolvedValue(undefined) }

    const module = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: RefundService, useValue: refund },
        { provide: CashierService, useValue: cashier },
      ],
    }).compile()

    service = module.get(WebhooksService)
  })

  describe('handleRechargeCallback（收单支付回调）', () => {
    it('幂等命中时直接返回成功响应，不查/写订单', async () => {
      redis.get.mockResolvedValue('1')
      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O1', {})
      expect(res).toBe('success')
      expect(prisma.paymentOrder.findUnique).not.toHaveBeenCalled()
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled()
    })

    it('成功路径：验签 -> 解析 -> 订单置 PAID -> 写幂等 -> 落库 SUCCESS', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder())
      prisma.paymentOrder.update.mockResolvedValue(makeOrder({ status: 'PAID', paidAt: new Date() }))

      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O1', {})
      expect(res).toBe('success')
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      )
      expect(redis.set).toHaveBeenCalledWith(expect.any(String), '1', 86400)
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channelCode: 'alipay', callbackType: 'recharge', status: 'SUCCESS' }),
        }),
      )
    })

    it('订单不存在时抛 NotFoundException 并落库 PROCESS_ERROR', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(
        service.handleRechargeCallback('alipay', 'out_trade_no=O1', {}),
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PROCESS_ERROR' }),
        }),
      )
    })

    it('渠道实付金额与订单金额不一致时拒绝确认支付', async () => {
      channelRegistry.getChannel.mockReturnValue({
        verifyWebhookSignature: jest.fn().mockReturnValue(true),
        parseRechargeCallback: jest.fn().mockReturnValue({
          orderNo: 'O1',
          amount: 200,
          status: 'SUCCESS',
          channelOrderNo: 'CH1',
        }),
      })
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder())
      await expect(
        service.handleRechargeCallback('alipay', 'out_trade_no=O1', {}),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled()
    })

    it('回调渠道与订单创建渠道不一致时拒绝', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ channel: 'wechat' }))
      await expect(
        service.handleRechargeCallback('alipay', 'out_trade_no=O1', {}),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled()
    })

    it('订单已终态（PAID）时幂等返回，不重复更新', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ status: 'PAID' }))
      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O1', {})
      expect(res).toBe('success')
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled()
    })

    it('渠道返回 FAILED 状态时保持 PENDING，不置终态', async () => {
      channelRegistry.getChannel.mockReturnValue({
        verifyWebhookSignature: jest.fn().mockReturnValue(true),
        parseRechargeCallback: jest.fn().mockReturnValue({
          orderNo: 'O1',
          amount: 100,
          status: 'FAILED',
          channelOrderNo: 'CH1',
        }),
      })
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder())
      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O1', {})
      expect(res).toBe('success')
      expect(prisma.paymentOrder.update).not.toHaveBeenCalled()
    })

    it('微信回调使用 rawBody hash 作为锁 key 后缀', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ channel: 'wechat' }))
      prisma.paymentOrder.update.mockResolvedValue(makeOrder({ channel: 'wechat', status: 'PAID' }))
      await service.handleRechargeCallback('wechat', '{"encrypted":"data"}', {})
      const outerLockKey = redis.withLock.mock.calls[0][0] as string
      expect(outerLockKey).toMatch(/^kb:lock:webhook:recharge:wechat:hash:[a-f0-9]{16}$/)
    })
  })

  describe('handleRechargeCallback 验签（纵深防御）', () => {
    it('幂等命中但签名无效时仍拒绝：验签优先于幂等检查', async () => {
      redis.get.mockResolvedValue('1')
      channelRegistry.getChannel.mockReturnValue({
        verifyWebhookSignature: jest.fn().mockReturnValue(false),
      })
      await expect(
        service.handleRechargeCallback('alipay', 'out_trade_no=O1', {}),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.paymentOrder.findUnique).not.toHaveBeenCalled()
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SIGNATURE_FAILED' }),
        }),
      )
    })

    it('验签抛错时落库 SIGNATURE_ERROR 并拒绝', async () => {
      channelRegistry.getChannel.mockReturnValue({
        verifyWebhookSignature: jest.fn().mockImplementation(() => {
          throw new Error('sig-throw')
        }),
      })
      await expect(
        service.handleRechargeCallback('wechat', '{"x":1}', {}),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'SIGNATURE_ERROR' }),
        }),
      )
    })
  })

  describe('handleRefundCallback（退款回调）', () => {
    it('成功路径：验签 -> 委托 refundService -> 写幂等 -> 落库 SUCCESS', async () => {
      const res = await service.handleRefundCallback('alipay', 'out_request_no=R1', {})
      expect(res).toBe('REFUND_OK')
      expect(refund.handleRefundCallback).toHaveBeenCalledWith('alipay', 'out_request_no=R1', {})
      expect(redis.set).toHaveBeenCalledWith(expect.any(String), '1', 86400)
      expect(prisma.webhookLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ callbackType: 'refund', status: 'SUCCESS' }),
        }),
      )
    })

    it('幂等命中时直接返回，不调用 refundService', async () => {
      redis.get.mockResolvedValue('1')
      const res = await service.handleRefundCallback('alipay', 'out_request_no=R1', {})
      expect(res).toBe('success')
      expect(refund.handleRefundCallback).not.toHaveBeenCalled()
    })

    it('验签失败时拒绝且不调用 refundService', async () => {
      channelRegistry.getChannel.mockReturnValue({
        verifyWebhookSignature: jest.fn().mockReturnValue(false),
      })
      await expect(
        service.handleRefundCallback('alipay', 'out_request_no=R1', {}),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(refund.handleRefundCallback).not.toHaveBeenCalled()
    })
  })

  describe('logCallback 容错', () => {
    it('落库失败仅记录日志，不影响主流程返回', async () => {
      prisma.webhookLog.create.mockRejectedValue(new Error('db-down'))
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder())
      prisma.paymentOrder.update.mockResolvedValue(makeOrder({ status: 'PAID' }))
      const res = await service.handleRechargeCallback('alipay', 'out_trade_no=O9', {})
      expect(res).toBe('success')
    })
  })
})
