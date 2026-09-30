import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenApiService } from './open-api.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RedisService } from '../redis/redis.service.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { RefundService } from '../payment-channels/refund.service.js'

type ConfigServiceMock = Record<'get', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock' | 'get' | 'set' | 'del' | 'acquireLock', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction'>
type RefundServiceMock = Record<'createRefund', jest.Mock>
type PrismaMock = {
  merchant: Record<string, jest.Mock>
  paymentOrder: Record<string, jest.Mock>
} & Record<string, unknown>

describe('OpenApiService', () => {
  let service: OpenApiService
  let prisma: PrismaMock
  let configService: ConfigServiceMock
  let redis: RedisMock
  let riskEngine: RiskEngineMock
  let refundService: RefundServiceMock

  const app = {
    id: 'app1',
    merchantId: 'm1',
    appId: 'app_xxx',
    appSecret: 'secret',
    name: '默认应用',
    callbackUrl: null,
    status: 'ACTIVE',
  }

  beforeEach(async () => {
    prisma = {
      merchant: { findUnique: jest.fn() },
      paymentOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn(),
      },
    }

    configService = { get: jest.fn().mockReturnValue(undefined) }
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      acquireLock: jest.fn().mockResolvedValue(true),
    }
    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }
    refundService = { createRefund: jest.fn() }

    const module = await Test.createTestingModule({
      providers: [
        OpenApiService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redis },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RefundService, useValue: refundService },
      ],
    }).compile()

    service = module.get(OpenApiService)
  })

  const merchant = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    userId: 'u2',
    merchantNo: 'M1',
    merchantName: '测试商户',
    status: 'APPROVED',
    ...overrides,
  })

  describe('createOrder 创建订单', () => {
    it('商户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.createOrder(app, { merchantOrderNo: 'MO1', amount: 10, subject: '商品' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('商户未审核通过抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant({ status: 'PENDING' }))
      await expect(
        service.createOrder(app, { merchantOrderNo: 'MO1', amount: 10, subject: '商品' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('金额小于等于 0 抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      await expect(
        service.createOrder(app, { merchantOrderNo: 'MO1', amount: 0, subject: '商品' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('成功创建订单', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue(null)
      prisma.paymentOrder.create.mockImplementation((args: unknown) => {
        const query = args as { data: Record<string, unknown> }
        return Promise.resolve({ id: 'po1', status: 'PENDING', ...query.data })
      })

      const result = await service.createOrder(app, { merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      expect(result.orderNo).toBeDefined()
      expect(result.amountYuan).toBe('10.00')
      expect(result.status).toBe('PENDING')
      expect(result.cashierUrl).toContain(result.orderNo)
    })

    it('幂等：同 merchantOrderNo 重复请求返回原订单不抛错', async () => {
      const existing = {
        orderNo: 'P1',
        appId: 'app_xxx',
        amount: 1000,
        status: 'PENDING',
        expiredAt: new Date(Date.now() + 60000),
      }
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue(existing)

      const result = await service.createOrder(app, { merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      expect(result.orderNo).toBe('P1')
      expect(prisma.paymentOrder.create).not.toHaveBeenCalled()
    })
  })

  describe('getOrder 查询订单', () => {
    it('订单不存在抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(service.getOrder(app, 'NOPE')).rejects.toThrow(NotFoundException)
    })

    it('跨商户查询抛错（app 归属校验）', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'po1', orderNo: 'P1', amount: 1000, fee: 0, refundAmount: 0, appId: 'app_other',
      })
      await expect(service.getOrder(app, 'P1')).rejects.toThrow(ForbiddenException)
    })

    it('同 app 查询返回正确订单', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({
        id: 'po1', orderNo: 'P1', amount: 1000, fee: 6, refundAmount: 0, appId: app.appId,
      })
      const result = await service.getOrder(app, 'P1')
      expect(result.orderNo).toBe('P1')
      expect(result.amountYuan).toBe('10.00')
      expect(result.feeYuan).toBe('0.06')
      expect(result.refundAmountYuan).toBe('0.00')
    })
  })

  describe('refund 退款（委托 RefundService）', () => {
    it('订单不存在抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(service.refund(app, { orderNo: 'NOPE' })).rejects.toThrow(NotFoundException)
    })

    it('跨 app 退款抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({ orderNo: 'P1', appId: 'app_other' })
      await expect(service.refund(app, { orderNo: 'P1' })).rejects.toThrow(ForbiddenException)
    })

    it('全额退款：委托 refundService 并回查实际退款额', async () => {
      prisma.paymentOrder.findUnique
        .mockResolvedValueOnce({ orderNo: 'P1', appId: app.appId }) // 归属校验
        .mockResolvedValueOnce({ refundAmount: 1000 }) // 回查实际退款额
      refundService.createRefund.mockResolvedValue({
        refundNo: 'RF1',
        channelRefundNo: 'CH_RF',
        status: 'SUCCESS',
        message: undefined,
      })

      const result = await service.refund(app, { orderNo: 'P1', reason: '缺货' })

      expect(refundService.createRefund).toHaveBeenCalledWith('P1', 0, '缺货', undefined)
      expect(result.refundNo).toBe('RF1')
      expect(result.status).toBe('SUCCESS')
      expect(result.refundAmountYuan).toBe('10.00')
    })

    it('部分退款：指定金额（元转分）后不再回查订单', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue({ orderNo: 'P1', appId: app.appId })
      refundService.createRefund.mockResolvedValue({
        refundNo: 'RF2',
        channelRefundNo: 'CH_RF2',
        status: 'PROCESSING',
        message: undefined,
      })

      const result = await service.refund(app, { orderNo: 'P1', amount: 5 })

      // 5 元 = 500 分
      expect(refundService.createRefund).toHaveBeenCalledWith('P1', 500, undefined, undefined)
      expect(result.refundAmountYuan).toBe('5.00')
    })
  })

  describe('balance 收单统计', () => {
    it('商户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.balance(app)).rejects.toThrow(NotFoundException)
    })

    it('返回收单统计（交易额/手续费/退款/结算额）', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      // 第一次 aggregate：已支付订单合计；第二次：退款合计
      prisma.paymentOrder.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 10000, fee: 100 }, _count: { id: 5 } })
        .mockResolvedValueOnce({ _sum: { refundAmount: 2000 } })

      const result = await service.balance(app)

      expect(result.merchantNo).toBe('M1')
      expect(result.totalAmountYuan).toBe('100.00')
      expect(result.totalFeeYuan).toBe('1.00')
      expect(result.totalRefundYuan).toBe('20.00')
      // 结算额 = 交易额 - 手续费 - 退款 = 10000 - 100 - 2000 = 7900 分
      expect(result.settledAmountYuan).toBe('79.00')
      expect(result.paidCount).toBe(5)
    })
  })
})
