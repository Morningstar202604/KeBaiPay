import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { createHash, createHmac } from 'crypto'
import * as helpers from '../common/helpers.js'
import { PaymentOrderStatus } from '../common/enums.js'
import { Prisma } from '@prisma/client'
import { CashierService } from './cashier.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { UsersService } from '../users/users.service.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { RedisService } from '../redis/redis.service.js'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry.js'

type UsersServiceMock = Record<'findById', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction', jest.Mock>
type ChannelRegistryMock = { getChannel: jest.Mock; getEnabledConfig: jest.Mock }
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  merchant: Record<string, jest.Mock>
  merchantApp: Record<string, jest.Mock>
  paymentOrder: Record<string, jest.Mock>
} & Record<string, unknown>

type CreateArgs = { data: Record<string, unknown> }

describe('CashierService', () => {
  let service: CashierService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let riskEngine: RiskEngineMock
  let channelRegistry: ChannelRegistryMock
  let redis: RedisMock

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      merchant: { findUnique: jest.fn() },
      merchantApp: { findUnique: jest.fn() },
      paymentOrder: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        aggregate: jest.fn(),
      },
    }

    usersService = {
      findById: jest.fn(),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    channelRegistry = {
      getChannel: jest.fn().mockReturnValue({
        createRecharge: jest.fn().mockResolvedValue({ channelOrderNo: 'CH1', payUrl: 'https://pay.example/cashier' }),
      }),
      getEnabledConfig: jest.fn().mockResolvedValue({ config: {} }),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        CashierService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
      ],
    }).compile()

    service = module.get(CashierService)
  })

  const verifiedPayer = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    ...overrides,
  })

  const merchant = (overrides: Record<string, unknown> = {}) => ({
    id: 'm1',
    userId: 'u2',
    merchantNo: 'M1',
    merchantName: '测试商户',
    status: 'APPROVED',
    payRate: 60,
    dailyLimit: 10000000,
    ...overrides,
  })

  const pendingOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 'po1',
    orderNo: 'P1',
    merchantId: 'm1',
    merchantOrderNo: 'MO1',
    amount: 1000,
    fee: 0,
    status: 'PENDING',
    channel: null,
    channelOrderNo: null,
    subject: '商品',
    merchant: merchant(),
    ...overrides,
  })

  describe('createOrder 创建支付订单', () => {
    it('商户不存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(
        service.createOrder('u2', { merchantOrderNo: 'MO1', amount: 10, subject: '商品' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('商户未审核通过抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant({ status: 'PENDING' }))
      await expect(
        service.createOrder('u2', { merchantOrderNo: 'MO1', amount: 10, subject: '商品' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('金额小于等于 0 抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      await expect(
        service.createOrder('u2', { merchantOrderNo: 'MO1', amount: 0, subject: '商品' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('商户订单号已存在抛错', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue({ id: 'po1' })
      await expect(
        service.createOrder('u2', { merchantOrderNo: 'MO1', amount: 10, subject: '商品' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('并发创建同商户订单号触发 P2002 时查回原单幂等返回', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      const existed = {
        id: 'po-existing',
        merchantId: 'm1',
        merchantOrderNo: 'MO1',
        orderNo: 'P-EXIST',
        amount: 1000,
        fee: 0,
        status: 'PENDING',
      }
      prisma.paymentOrder.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existed)
      prisma.paymentOrder.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      )

      const order = await service.createOrder('u2', { merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      expect(order.id).toBe('po-existing')
      expect(order.merchantOrderNo).toBe('MO1')
    })

    it('成功创建支付订单(PENDING)', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findFirst.mockResolvedValue(null)
      prisma.paymentOrder.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 'po1', status: 'PENDING', ...query.data })
      })

      const order = await service.createOrder('u2', { merchantOrderNo: 'MO1', amount: 10, subject: '商品' })
      expect(order.status).toBe('PENDING')
      expect(order.amount).toBe(1000)
      expect(order.merchantId).toBe('m1')
      expect(order.merchantOrderNo).toBe('MO1')
      expect(order.expiredAt).toBeInstanceOf(Date)
    })
  })

  describe('createChannelPay 发起渠道支付', () => {
    const setupHappyPath = (orderOverrides: Record<string, unknown> = {}) => {
      prisma.paymentOrder.findUnique.mockResolvedValue(pendingOrder(orderOverrides))
      usersService.findById.mockResolvedValue(verifiedPayer())
      riskEngine.check.mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] })
      channelRegistry.getChannel.mockReturnValue({
        createRecharge: jest.fn().mockResolvedValue({ channelOrderNo: 'CH1', payUrl: 'https://pay.example/cashier' }),
      })
      channelRegistry.getEnabledConfig.mockResolvedValue({ config: {} })
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 })
      prisma.paymentOrder.update.mockResolvedValue({})
    }

    it('订单不存在抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(null)
      await expect(service.createChannelPay('u1', 'NOPE', 'mock')).rejects.toThrow(NotFoundException)
    })

    it('订单非 PENDING 抛错', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(pendingOrder({ status: 'PAID' }))
      await expect(service.createChannelPay('u1', 'P1', 'mock')).rejects.toThrow(BadRequestException)
    })

    it('商户未审批通过抛 Forbidden', async () => {
      prisma.paymentOrder.findUnique.mockResolvedValue(
        pendingOrder({ merchant: merchant({ status: 'PENDING' }) }),
      )
      await expect(service.createChannelPay('u1', 'P1', 'mock')).rejects.toThrow(ForbiddenException)
    })

    it('付款方未实名抛 Forbidden', async () => {
      setupHappyPath()
      usersService.findById.mockResolvedValue(verifiedPayer({ realNameStatus: 'PENDING' }))
      await expect(service.createChannelPay('u1', 'P1', 'mock')).rejects.toThrow(ForbiddenException)
    })

    it('风控拦截抛 Forbidden', async () => {
      setupHappyPath()
      riskEngine.check.mockResolvedValue({ passed: false, blocked: true, warnings: [], rules: [{ action: 'BLOCK', name: '高频' }] })
      await expect(service.createChannelPay('u1', 'P1', 'mock')).rejects.toThrow(ForbiddenException)
    })

    it('渠道未配置抛 BadRequest', async () => {
      setupHappyPath()
      channelRegistry.getChannel.mockReturnValue(null)
      await expect(service.createChannelPay('u1', 'P1', 'mock')).rejects.toThrow(BadRequestException)
    })

    it('成功：绑定渠道 -> 调渠道下单 -> 回写渠道单号 -> 返回支付链接', async () => {
      setupHappyPath()
      const result = await service.createChannelPay('u1', 'P1', 'mock', { clientIp: '1.2.3.4' })

      expect(result.orderNo).toBe('P1')
      expect(result.payUrl).toBe('https://pay.example/cashier')
      // 订单原子绑定渠道
      expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'po1', status: 'PENDING', channel: null }),
          data: { channel: 'mock' },
        }),
      )
      // 渠道下单后回写渠道单号
      expect(prisma.paymentOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { channelOrderNo: 'CH1' } }),
      )
    })
  })

  describe('closeExpiredOrders 关闭过期订单', () => {
    it('批量关闭过期订单', async () => {
      prisma.paymentOrder.updateMany.mockResolvedValue({ count: 3 })
      prisma.paymentOrder.findMany.mockResolvedValue([])
      await service.closeExpiredOrders()
      expect(prisma.paymentOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
            expiredAt: { lt: expect.any(Date) },
          }),
          data: { status: 'CLOSED' },
        }),
      )
    })
  })

  describe('listMyOrders 商户订单列表', () => {
    it('非商户用户返回空分页（不再 404）', async () => {
      prisma.merchant.findUnique.mockResolvedValue(null)
      await expect(service.listMyOrders('u1', {})).resolves.toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      })
    })

    it('支持按状态筛选', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findMany.mockResolvedValue([])
      prisma.paymentOrder.count.mockResolvedValue(0)

      await service.listMyOrders('u2', { status: PaymentOrderStatus.PAID, page: 1, limit: 10 })
      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { merchantId: 'm1', status: 'PAID' } }),
      )
    })

    it('支持按日期范围筛选', async () => {
      prisma.merchant.findUnique.mockResolvedValue(merchant())
      prisma.paymentOrder.findMany.mockResolvedValue([])
      prisma.paymentOrder.count.mockResolvedValue(0)

      await service.listMyOrders('u2', { startDate: '2025-01-01', endDate: '2025-01-31' })
      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            merchantId: 'm1',
            createdAt: {
              gte: new Date('2025-01-01T00:00:00'),
              lte: new Date('2025-01-31T23:59:59'),
            },
          },
        }),
      )
    })
  })

  describe('notifyMerchant 商户回调验签', () => {
    it('X-KB-Signature 可被只有明文 appSecret 的商户验证（sha256 预哈希密钥口径）', async () => {
      const plaintextSecret = 'plain_secret_abc'
      const secretHash = createHash('sha256').update(plaintextSecret).digest('hex')
      prisma.merchantApp = {
        findUnique: jest.fn().mockResolvedValue({ appSecret: secretHash }),
      }
      prisma.paymentOrder.findUnique.mockResolvedValue({
        notifyStatus: 'PENDING',
        notifyCount: 0,
        callbackUrl: 'https://callback.example.com/notify',
      })
      prisma.paymentOrder.update.mockResolvedValue({ notifyStatus: 'SUCCESS', notifyCount: 1 })

      jest.spyOn(helpers, 'isCallbackUrlSafe').mockResolvedValue({ safe: true })
      let receivedSig = ''
      let receivedBody = ''
      jest.spyOn(helpers, 'postJsonPinned').mockImplementation(
        async (_url, body, headers) => {
          receivedSig = (headers as Record<string, string>)['X-KB-Signature']
          receivedBody = body as string
          return { ok: true, status: 200 }
        },
      )

      const result = await service.notifyMerchant({
        id: 'po1',
        orderNo: 'P1',
        merchantOrderNo: 'MO1',
        amount: 1000,
        status: PaymentOrderStatus.PAID,
        paidAt: new Date('2026-01-01T00:00:00Z'),
        callbackUrl: 'https://callback.example.com/notify',
        appId: 'app_1',
      })

      expect(result.notifyStatus).toBe('SUCCESS')
      const merchantExpected = createHmac('sha256', createHash('sha256').update(plaintextSecret).digest())
        .update(receivedBody)
        .digest('hex')
      expect(receivedSig).toBe(merchantExpected)
    })
  })
})
