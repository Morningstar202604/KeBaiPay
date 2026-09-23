import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { TransfersService } from './transfers.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { UsersService } from '../users/users.service.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { RedisService } from '../redis/redis.service.js'
import { kbError, KBErrorCodes } from '../common/error-codes.js'

type UsersServiceMock = Record<'findById' | 'verifyPayPassword' | 'checkAndIncrementDailyLimit', jest.Mock>
type RiskEngineMock = Record<'check' | 'recordTransaction', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  systemConfig: Record<string, jest.Mock>
  transactionOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  dailyLimitUsage: Record<string, jest.Mock>
  accountLedger?: Record<string, jest.Mock>
  bill?: Record<string, jest.Mock>
  riskEvent?: Record<string, jest.Mock>
} & Record<string, unknown>

describe('TransfersService', () => {
  let service: TransfersService
  let prisma: PrismaMock
  let usersService: UsersServiceMock
  let riskEngine: RiskEngineMock
  let redis: RedisMock

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      systemConfig: { findUnique: jest.fn() },
      transactionOrder: { aggregate: jest.fn(), findUnique: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      dailyLimitUsage: { upsert: jest.fn(), updateMany: jest.fn() },
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn(),
      checkAndIncrementDailyLimit: jest.fn(),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ passed: true, blocked: false, warnings: [], rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(TransfersService)
  })

  const verifiedUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    nickname: '张三',
    realNameStatus: 'VERIFIED',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    ...overrides,
  })

  describe('transfer 参数校验', () => {
    it('金额小于等于 0 报错', async () => {
      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 0, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('不能给自己转账', async () => {
      await expect(
        service.transfer('u1', { toUserId: 'u1', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('transfer 实名与状态校验', () => {
    it('未实名不能转账', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ realNameStatus: 'PENDING' }))
      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('冻结账户不能转账', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ status: 'FROZEN' }))
      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('高风险用户不能转账', async () => {
      usersService.findById.mockResolvedValue(verifiedUser({ riskLevel: 'HIGH' }))
      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('transfer 风控检查', () => {
    beforeEach(() => {
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedUser())
        if (id === 'u2') return Promise.resolve(verifiedUser({ id: 'u2', nickname: '李四' }))
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
    })

    it('风控拦截时抛 ForbiddenException', async () => {
      riskEngine.check.mockResolvedValue({
        passed: false,
        blocked: true,
        warnings: [],
        rules: [
          { code: 'single_amount', name: '单笔金额限额', action: 'BLOCK', message: '超过限额' },
        ],
      })

      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 100000, payPassword: '123456' }),
      ).rejects.toThrow(ForbiddenException)
      // 风控检查以分为单位
      expect(riskEngine.check).toHaveBeenCalledWith({
        userId: 'u1',
        type: 'TRANSFER',
        amount: 10000000,
      })
      // 被拦截后不应进入事务
      expect(prisma.account.updateMany).not.toHaveBeenCalled()
    })

    it('风控通过时正常进入事务', async () => {
      riskEngine.check.mockResolvedValue({
        passed: true,
        blocked: false,
        warnings: ['高频交易提醒'],
        rules: [],
      })
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as { where: { userId?: string; id?: string } }
        // H1: 按 id 查询为扣款后重新读取真实余额（availableBalance 已扣减 1000）
        if (query.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 99000, totalBalance: 99000, status: 'ACTIVE' })
        if (query.where.userId === 'u1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 100000, totalBalance: 100000, status: 'ACTIVE' })
        if (query.where.userId === 'u2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 1000, totalBalance: 1000 })
      prisma.transactionOrder.create = jest.fn().mockResolvedValue({ id: 't1', orderNo: 'T1' })
      prisma.accountLedger = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.bill = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.riskEvent = { create: jest.fn().mockResolvedValue({}) }

      const order = await service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' })
      expect(order).toBeDefined()
      expect(riskEngine.check).toHaveBeenCalled()
    })
  })

  describe('transfer 余额校验', () => {
    beforeEach(() => {
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedUser())
        if (id === 'u2') return Promise.resolve(verifiedUser({ id: 'u2', nickname: '李四' }))
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
      // 不设限额
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
    })

    it('余额不足报错', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 100, // 1 元
        totalBalance: 100,
        status: 'ACTIVE',
      })
      prisma.account.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 50, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
    })

    it('余额充足时转账成功', async () => {
      prisma.account.findUnique.mockImplementation((args: { where: { userId?: string; id?: string } }) => {
        // H1: 按 id 查询为扣款后重新读取真实余额（a1 扣减 1000 后为 9000）
        if (args.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 9000, totalBalance: 9000, status: 'ACTIVE' })
        if (args.where.userId === 'u1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 10000, totalBalance: 10000, status: 'ACTIVE' })
        if (args.where.userId === 'u2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 5000, totalBalance: 5000, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 6000, totalBalance: 6000 })
      prisma.transactionOrder.create = jest.fn().mockResolvedValue({ id: 't1', orderNo: 'T123' })
      prisma.accountLedger = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.bill = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.riskEvent = { create: jest.fn().mockResolvedValue({}) }

      const order = await service.transfer('u1', { toUserId: 'u2', amount: 10, payPassword: '123456' })
      expect(order.orderNo).toBe('T123')
      // 发送方扣款使用 updateMany，收款方入账使用 update
      expect(prisma.account.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.account.update).toHaveBeenCalledTimes(1)
      expect(prisma.account.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', availableBalance: { gte: 1000 } },
        data: {
          availableBalance: { decrement: 1000 },
          totalBalance: { decrement: 1000 },
        },
      })
      // H1: 账本 balanceBefore/After 基于更新后真实余额计算
      // P0-7/P0-8 写放大优化断言：2 条同表 accountLedger 经 createMany 一次批量写入
      //（原 2 次串行 create → 现 1 次 createMany），data 数组两条内容与逐条版逐字段一致：
      //  1) 发送方 a1：CREDIT，balanceBefore=10000、balanceAfter=9000
      //  2) 收款方 a2：DEBIT，balanceBefore=5000、balanceAfter=6000
      expect(prisma.accountLedger.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.accountLedger.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            accountId: 'a1',
            type: 'TRANSFER',
            amount: 1000,
            balanceBefore: 10000,
            balanceAfter: 9000,
            direction: 'CREDIT',
          }),
          expect.objectContaining({
            accountId: 'a2',
            type: 'TRANSFER',
            amount: 1000,
            balanceBefore: 5000,
            balanceAfter: 6000,
            direction: 'DEBIT',
          }),
        ],
      })
      // 非大额（10 元）不写 riskEvent
      expect(prisma.riskEvent.create).not.toHaveBeenCalled()
      // 2 条同表 bill 经 createMany 一次批量写入，内容与逐条版一致
      expect(prisma.bill.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.bill.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: 'u1',
            type: 'TRANSFER',
            direction: 'EXPENSE',
            amount: 1000,
            counterparty: '李四',
          }),
          expect.objectContaining({
            userId: 'u2',
            type: 'RECEIPT',
            direction: 'INCOME',
            amount: 1000,
            counterparty: '张三',
          }),
        ],
      })
    })
  })

  describe('transfer 单日限额', () => {
    beforeEach(() => {
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedUser())
        if (id === 'u2') return Promise.resolve(verifiedUser({ id: 'u2', nickname: '李四' }))
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
    })

    it('超过单日限额被拒绝', async () => {
      // 限额 1000 元
      prisma.systemConfig.findUnique.mockResolvedValue({ value: '1000' })
      usersService.checkAndIncrementDailyLimit.mockRejectedValue(
        new BadRequestException(kbError(KBErrorCodes.DAILY_LIMIT_EXCEEDED)),
      )

      await expect(
        service.transfer('u1', { toUserId: 'u2', amount: 100, payPassword: '123456' }),
      ).rejects.toThrow(BadRequestException)
      expect(usersService.checkAndIncrementDailyLimit).toHaveBeenCalledWith(
        prisma,
        'u1',
        'TRANSFER',
        expect.any(String),
        10000,
        100000,
      )
    })

    it('未超限额放行', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null) // 默认 5 万
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as { where: { userId?: string; id?: string } }
        // H1: 按 id 查询为扣款后真实余额（100 元 = 10000 分，扣减后 90000）
        if (query.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 90000, totalBalance: 90000, status: 'ACTIVE' })
        if (query.where.userId === 'u1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 100000, totalBalance: 100000, status: 'ACTIVE' })
        if (query.where.userId === 'u2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 10000, totalBalance: 10000 })
      prisma.transactionOrder.create = jest.fn().mockResolvedValue({ id: 't1', orderNo: 'T1' })
      prisma.accountLedger = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.bill = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.riskEvent = { create: jest.fn().mockResolvedValue({}) }

      const order = await service.transfer('u1', { toUserId: 'u2', amount: 100, payPassword: '123456' })
      expect(order).toBeDefined()
      // 非大额：账本/账单各 1 次 createMany，不写 riskEvent
      expect(prisma.accountLedger.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.bill.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.riskEvent.create).not.toHaveBeenCalled()
    })

    it('大额转账：账本/账单批量写入 + 并发落 riskEvent', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null) // 默认 5 万日限
      usersService.checkAndIncrementDailyLimit.mockResolvedValue(undefined)
      prisma.account.findUnique.mockImplementation((args: unknown) => {
        const query = args as { where: { userId?: string; id?: string } }
        // H1: 按 id 查询为扣款后真实余额（10 万元 = 10000000 分，扣减后 0）
        if (query.where.id === 'a1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        if (query.where.userId === 'u1') return Promise.resolve({ id: 'a1', userId: 'u1', availableBalance: 10000000, totalBalance: 10000000, status: 'ACTIVE' })
        if (query.where.userId === 'u2') return Promise.resolve({ id: 'a2', userId: 'u2', availableBalance: 0, totalBalance: 0, status: 'ACTIVE' })
        return Promise.resolve(null)
      })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ availableBalance: 10000000, totalBalance: 10000000 })
      prisma.transactionOrder.create = jest.fn().mockResolvedValue({ id: 't1', orderNo: 'T9' })
      prisma.accountLedger = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.bill = { createMany: jest.fn().mockResolvedValue({ count: 2 }) }
      prisma.riskEvent = { create: jest.fn().mockResolvedValue({}) }

      const order = await service.transfer('u1', { toUserId: 'u2', amount: 100000, payPassword: '123456' })
      expect(order).toBeDefined()
      // 大额（10 万 = 10000000 分）：账本/账单批量 + riskEvent 大额事件并发
      expect(prisma.accountLedger.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.accountLedger.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            accountId: 'a1',
            amount: 10000000,
            balanceBefore: 10000000,
            balanceAfter: 0,
            direction: 'CREDIT',
          }),
          expect.objectContaining({
            accountId: 'a2',
            amount: 10000000,
            balanceBefore: 0,
            balanceAfter: 10000000,
            direction: 'DEBIT',
          }),
        ],
      })
      expect(prisma.bill.createMany).toHaveBeenCalledTimes(1)
      expect(prisma.riskEvent.create).toHaveBeenCalledTimes(1)
      expect(prisma.riskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'LARGE_TRANSFER',
            level: 'MEDIUM',
            description: expect.stringContaining('大额转账'),
          }),
        }),
      )
    })
  })

  describe('transfer 幂等', () => {
    beforeEach(() => {
      usersService.findById.mockImplementation((id: string) => {
        if (id === 'u1') return Promise.resolve(verifiedUser())
        if (id === 'u2') return Promise.resolve(verifiedUser({ id: 'u2', nickname: '李四' }))
        return Promise.resolve(null)
      })
      usersService.verifyPayPassword.mockResolvedValue(true)
    })

    it('相同 idempotencyKey 直接返回已有订单', async () => {
      const existingOrder = { id: 't-existing', orderNo: 'TEXIST', fromUserId: 'u1' }
      prisma.transactionOrder.findUnique.mockResolvedValue(existingOrder)

      const order = await service.transfer('u1', {
        toUserId: 'u2',
        amount: 10,
        payPassword: '123456',
        idempotencyKey: 'key-1',
      })

      expect(order).toBe(existingOrder)
      expect(prisma.account.updateMany).not.toHaveBeenCalled()
      expect(prisma.account.update).not.toHaveBeenCalled()
    })
  })
})
