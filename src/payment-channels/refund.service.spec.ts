import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { RefundService, RefundStatus } from './refund.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RedisService } from '../redis/redis.service.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { PaymentChannelRegistry } from './payment-channel.registry.js'
import { PaymentChannelBridge } from './payment-channel.bridge.js'
import { PaymentOrderStatus } from '../common/enums.js'

type PrismaMock = {
  paymentOrder: {
    findUnique: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
    count: jest.Mock
    aggregate: jest.Mock
  }
  $transaction: jest.Mock
}
type RedisMock = { withLock: jest.Mock }
type ChannelRegistryMock = { getChannel: jest.Mock; getEnabledConfig: jest.Mock }
type BridgeMock = { refund: jest.Mock; queryRefund: jest.Mock }
type RiskMock = { recordTransaction: jest.Mock }

// 收单订单（PaymentOrder）内嵌退款字段子集
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNo: 'O1',
    amount: 10000,
    status: PaymentOrderStatus.PAID,
    channel: 'mock',
    channelOrderNo: 'CH1',
    refundAmount: 0,
    refundStatus: null as string | null,
    refundPendingAmount: 0,
    refundNo: null as string | null,
    refundChannelNo: null as string | null,
    refundIdempotencyKey: null as string | null,
    payerId: 'u1',
    ...overrides,
  }
}

describe('RefundService', () => {
  let service: RefundService
  let prisma: PrismaMock
  let redis: RedisMock
  let channelRegistry: ChannelRegistryMock
  let bridge: BridgeMock
  let risk: RiskMock

  beforeEach(async () => {
    prisma = {
      paymentOrder: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { refundAmount: 0 } }),
      },
      // $transaction 回调形式：把同一 prisma 作为 tx 传入复用 mock
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    }
    redis = {
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    }
    channelRegistry = {
      getChannel: jest.fn().mockReturnValue({
        parseRefundCallback: jest.fn().mockReturnValue({
          refundNo: 'RF1',
          status: 'SUCCESS',
          channelRefundNo: 'CH_RF',
        }),
        buildRefundCallbackSuccess: jest.fn().mockReturnValue('OK'),
      }),
      getEnabledConfig: jest.fn().mockResolvedValue({ config: {} }),
    }
    bridge = {
      refund: jest.fn().mockResolvedValue({ channelRefundNo: 'CH_RF', status: 'SUCCESS' }),
      queryRefund: jest.fn().mockResolvedValue({ status: 'SUCCESS', channelRefundNo: 'CH_RF' }),
    }
    risk = { recordTransaction: jest.fn().mockResolvedValue(undefined) }

    const module = await Test.createTestingModule({
      providers: [
        RefundService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: PaymentChannelBridge, useValue: bridge },
        { provide: RiskEngineService, useValue: risk },
      ],
    }).compile()

    service = module.get(RefundService)
  })

  describe('createRefund 发起退款', () => {
    it('退款金额 <= 0 抛 BadRequestException（不进锁）', async () => {
      await expect(service.createRefund('O1', 0)).rejects.toBeInstanceOf(BadRequestException)
      expect(redis.withLock).not.toHaveBeenCalled()
    })

    it('原订单不存在抛 NotFoundException', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(service.createRefund('O1', 100)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('订单非 PAID 状态不可退款', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ status: PaymentOrderStatus.PENDING }))
      await expect(service.createRefund('O1', 100)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('退款金额超过可退余额（amount - 已退）抛 BadRequest', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ refundAmount: 8000 }))
      await expect(service.createRefund('O1', 3000)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('幂等键命中已存在退款单时直接返回，不调渠道', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        makeOrder({ refundIdempotencyKey: 'k1', refundNo: 'RF_EXIST', refundChannelNo: 'CH_OLD', refundStatus: RefundStatus.SUCCESS }),
      )
      const res = await service.createRefund('O1', 100, undefined, 'k1')
      expect(res).toEqual({ refundNo: 'RF_EXIST', channelRefundNo: 'CH_OLD', status: RefundStatus.SUCCESS })
      expect(bridge.refund).not.toHaveBeenCalled()
    })

    it('退款处理中（PROCESSING）不可重复发起', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ refundStatus: RefundStatus.PROCESSING }))
      await expect(service.createRefund('O1', 100)).rejects.toBeInstanceOf(BadRequestException)
      expect(bridge.refund).not.toHaveBeenCalled()
    })

    it('渠道返回 PROCESSING 时退款单置 PENDING，不触发入账', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder())
      bridge.refund.mockResolvedValue({ channelRefundNo: 'CH_RF', status: 'PROCESSING' })
      const res = await service.createRefund('O1', 100)
      expect(res.status).toBe(RefundStatus.PENDING)
      // 不应触发退款入账（refundStatus SUCCESS 累加）
      expect(prisma.paymentOrder.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ refundStatus: RefundStatus.SUCCESS }) }),
      )
    })

    it('渠道抛错时退款单置 FAILED 并抛 BadRequest', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder())
      bridge.refund.mockRejectedValue(new Error('channel-down'))
      await expect(service.createRefund('O1', 100)).rejects.toBeInstanceOf(BadRequestException)
      const updateCalls = prisma.paymentOrder.update.mock.calls.map((c: any[]) => c[0].data.refundStatus)
      expect(updateCalls).toContain(RefundStatus.FAILED)
    })

    it('渠道返回 SUCCESS：内嵌退款单置 SUCCESS + 累加 refundAmount + 记风控', async () => {
      // 第一次 findUnique：createRefund 内查原单
      // 第二次 findUnique：processRefundSuccess 内按 refundNo 查（select 字段）
      prisma.paymentOrder.findUnique
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValueOnce({
          id: 'o1',
          amount: 10000,
          refundAmount: 0,
          refundStatus: RefundStatus.PROCESSING,
          refundPendingAmount: 100,
          payerId: 'u1',
        })
      bridge.refund.mockResolvedValue({ channelRefundNo: 'CH_RF', status: 'SUCCESS' })

      const res = await service.createRefund('O1', 100)
      expect(res.status).toBe(RefundStatus.SUCCESS)
      // 入账：refundAmount 原子累加，订单仍 PAID（未全额退）
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            refundAmount: 100,
            refundStatus: RefundStatus.SUCCESS,
            status: PaymentOrderStatus.PAID,
          }),
        }),
      )
      expect(risk.recordTransaction).toHaveBeenCalledWith({ userId: 'u1', type: 'REFUND', amount: 100 })
    })
  })

  describe('queryRefund 查询退款', () => {
    it('退款单不存在抛 NotFound', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(service.queryRefund('RF_NONE')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('已 SUCCESS 直接返回，不查渠道', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ refundStatus: RefundStatus.SUCCESS }))
      const res = await service.queryRefund('RF1')
      expect(res.status).toBe(RefundStatus.SUCCESS)
      expect(bridge.queryRefund).not.toHaveBeenCalled()
    })

    it('PENDING 返回处理中提示，不查渠道', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(makeOrder({ refundStatus: RefundStatus.PENDING }))
      const res = await service.queryRefund('RF1')
      expect(res.status).toBe(RefundStatus.PENDING)
      expect(res.message).toBe('退款处理中')
      expect(bridge.queryRefund).not.toHaveBeenCalled()
    })

    it('PROCESSING 主动查询渠道并同步状态', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        makeOrder({ refundStatus: RefundStatus.PROCESSING, channel: 'mock', refundChannelNo: 'CH_RF' }),
      )
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 0 }) // 未抢到迁移权，不再入账
      bridge.queryRefund.mockResolvedValue({ status: 'SUCCESS' })
      const res = await service.queryRefund('RF1')
      expect(res.status).toBe('SUCCESS')
      expect(bridge.queryRefund).toHaveBeenCalled()
    })
  })

  describe('handleRefundCallback 退款回调', () => {
    it('退款单不存在抛 NotFound', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(service.handleRefundCallback('mock', 'body', {})).rejects.toBeInstanceOf(NotFoundException)
    })

    it('已终态（SUCCESS/FAILED）幂等返回成功响应，不重复迁移', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        makeOrder({ refundStatus: RefundStatus.SUCCESS, channel: 'mock' }),
      )
      const res = await service.handleRefundCallback('mock', 'body', {})
      expect(res).toBe('OK')
      expect(prisma.paymentOrder.updateMany).not.toHaveBeenCalled()
    })

    it('回调渠道与订单渠道不一致抛 BadRequest', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        makeOrder({ refundStatus: RefundStatus.PROCESSING, channel: 'alipay' }),
      )
      await expect(service.handleRefundCallback('mock', 'body', {})).rejects.toBeInstanceOf(BadRequestException)
    })

    it('退款成功回调：条件迁移 + 累加 refundAmount', async () => {
      prisma.paymentOrder.findUnique
        // 事务内按 refundNo 查
        .mockResolvedValueOnce(makeOrder({ refundStatus: RefundStatus.PROCESSING, channel: 'mock' }))
        // processRefundSuccess 内按 refundNo 查（select）
        .mockResolvedValueOnce({
          id: 'o1',
          amount: 10000,
          refundAmount: 0,
          refundStatus: RefundStatus.PROCESSING,
          refundPendingAmount: 100,
          payerId: 'u1',
        })
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 })

      const res = await service.handleRefundCallback('mock', 'body', {})
      expect(res).toBe('OK')
      const updateArgs = prisma.paymentOrder.updateMany.mock.calls[0][0]
      expect(updateArgs.data.refundStatus).toBe(RefundStatus.SUCCESS)
      expect(updateArgs.where.refundStatus).toEqual({ in: [RefundStatus.PENDING, RefundStatus.PROCESSING] })
      // 入账累加
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ refundAmount: 100, refundStatus: RefundStatus.SUCCESS }),
        }),
      )
    })
  })

  describe('getRefundStats 退款统计', () => {
    it('返回总数、累计退款金额、待处理数', async () => {
      prisma.paymentOrder.count
        .mockResolvedValueOnce(5) // totalRefunds
        .mockResolvedValueOnce(2) // pendingRefunds
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { refundAmount: 12345 } })
      const res = await service.getRefundStats('u1')
      expect(res).toEqual({ totalRefunds: 5, totalRefundAmount: 12345, pendingRefunds: 2 })
    })

    it('无数据时归零', async () => {
      prisma.paymentOrder.count.mockResolvedValue(0)
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { refundAmount: null } })
      const res = await service.getRefundStats('u1')
      expect(res).toEqual({ totalRefunds: 0, totalRefundAmount: 0, pendingRefunds: 0 })
    })
  })
})
