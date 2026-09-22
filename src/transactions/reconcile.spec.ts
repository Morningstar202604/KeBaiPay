import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { TransactionsService } from './transactions.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { UsersService } from '../users/users.service.js'
import { RedisService } from '../redis/redis.service.js'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry.js'
import { PaymentChannelBridge } from '../payment-channels/payment-channel.bridge.js'
import { ConnectorRegistry } from '../payment-channels/connector.registry.js'
import { ConnectorRouter } from '../payment-channels/connector-router.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { JournalService } from '../finance/journal.service.js'

type PrismaMock = {
  $transaction: jest.Mock
  transactionOrder: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
} & Record<string, unknown>

/**
 * PENDING 充值订单自动补单（reconcilePendingRecharge）专项测试
 *
 * 关键不变量：
 * - 与回调共用同一把锁（recharge:callback:{orderNo}），互斥不双入账
 * - 终态幂等：回调抢先完成后补单跳过
 * - H2 金额核对：渠道查单金额 ≠ 订单金额拒绝入账；未返回金额同样拒绝（fail-closed）
 * - 无渠道单号跳过；查单抛错视为未确认保持 PENDING
 */
describe('TransactionsService.reconcilePendingRecharge', () => {
  let service: TransactionsService
  let prisma: PrismaMock
  let redis: { isEnabled: jest.Mock; withLock: jest.Mock }
  let channelRegistry: { getChannel: jest.Mock; getEnabledConfig: jest.Mock }
  let riskEngine: { recordTransaction: jest.Mock }
  let journalService: { createEntries: jest.Mock }
  let queryOrder: jest.Mock

  const baseOrder = {
    id: 'ord1',
    orderNo: 'R_TEST_1',
    channel: 'mock',
    channelOrderNo: 'MOCK_R_TEST_1',
    amount: 10000,
    toUserId: 'u1',
  }

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (p: PrismaMock) => Promise<unknown>) => cb(prisma)),
      transactionOrder: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      account: { findUnique: jest.fn(), update: jest.fn() },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
    }
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    }
    // 可编程的渠道 queryOrder mock
    queryOrder = jest.fn()
    channelRegistry = {
      getChannel: jest.fn().mockReturnValue({ queryOrder }),
      getEnabledConfig: jest.fn().mockResolvedValue({ code: 'mock', config: {} }),
    }
    riskEngine = { recordTransaction: jest.fn().mockResolvedValue(undefined) }
    journalService = { createEntries: jest.fn().mockResolvedValue(undefined) }

    const module = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: { verifyPayPassword: jest.fn() } },
        { provide: RedisService, useValue: redis },
        { provide: PaymentChannelRegistry, useValue: channelRegistry },
        { provide: PaymentChannelBridge, useValue: {} },
        { provide: ConnectorRegistry, useValue: {} },
        { provide: ConnectorRouter, useValue: {} },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: JournalService, useValue: journalService },
      ],
    }).compile()

    service = module.get(TransactionsService)
  })

  it('渠道确认成功且金额一致：补单入账', async () => {
    queryOrder.mockResolvedValue({
      channelOrderNo: 'MOCK_R_TEST_1',
      status: 'SUCCESS',
      totalAmount: 10000,
    })
    prisma.transactionOrder.findUnique.mockResolvedValue({
      ...baseOrder,
      status: 'PENDING',
    })
    prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'u1' })
    prisma.account.update.mockResolvedValue({ id: 'acc1', availableBalance: 20000 })
    prisma.transactionOrder.update.mockResolvedValue({})
    prisma.accountLedger.create.mockResolvedValue({})
    prisma.bill.create.mockResolvedValue({})

    const action = await service.reconcilePendingRecharge(baseOrder)

    expect(action).toBe('CREDITED')
    // 与回调共用同一把锁
    expect(redis.withLock).toHaveBeenCalledWith(
      'recharge:callback:R_TEST_1',
      expect.any(Number),
      expect.any(Function),
    )
    // 入账动作完整：余额更新 + 订单置 SUCCESS + 流水 + 账单 + 复式记账
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          availableBalance: { increment: 10000 },
          totalBalance: { increment: 10000 },
        }),
      }),
    )
    expect(prisma.transactionOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCESS' }),
      }),
    )
    expect(prisma.accountLedger.create).toHaveBeenCalled()
    expect(prisma.bill.create).toHaveBeenCalled()
    expect(journalService.createEntries).toHaveBeenCalled()
    // 风控记录（事务提交后）
    expect(riskEngine.recordTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'RECHARGE', amount: 10000 }),
    )
  })

  it('渠道查单金额与订单金额不一致：拒绝入账（H2 fail-closed）', async () => {
    queryOrder.mockResolvedValue({
      channelOrderNo: 'MOCK_R_TEST_1',
      status: 'SUCCESS',
      totalAmount: 5000,
    })
    prisma.transactionOrder.findUnique.mockResolvedValue({
      ...baseOrder,
      status: 'PENDING',
    })

    const action = await service.reconcilePendingRecharge(baseOrder)

    expect(action).toBe('SKIPPED')
    expect(prisma.account.update).not.toHaveBeenCalled()
    expect(prisma.transactionOrder.update).not.toHaveBeenCalled()
  })

  it('渠道查单未返回金额：拒绝入账（fail-closed）', async () => {
    queryOrder.mockResolvedValue({
      channelOrderNo: 'MOCK_R_TEST_1',
      status: 'SUCCESS',
      totalAmount: undefined,
    })
    prisma.transactionOrder.findUnique.mockResolvedValue({
      ...baseOrder,
      status: 'PENDING',
    })

    const action = await service.reconcilePendingRecharge(baseOrder)

    expect(action).toBe('SKIPPED')
    expect(prisma.account.update).not.toHaveBeenCalled()
  })

  it('终态幂等：订单已被回调置 SUCCESS 后补单跳过', async () => {
    queryOrder.mockResolvedValue({
      channelOrderNo: 'MOCK_R_TEST_1',
      status: 'SUCCESS',
      totalAmount: 10000,
    })
    prisma.transactionOrder.findUnique.mockResolvedValue({
      ...baseOrder,
      status: 'SUCCESS',
    })

    const action = await service.reconcilePendingRecharge(baseOrder)

    expect(action).toBe('SKIPPED')
    expect(prisma.account.update).not.toHaveBeenCalled()
  })

  it('渠道查询为 FAILED/CLOSED：订单置 FAILED 不入账', async () => {
    queryOrder.mockResolvedValue({
      channelOrderNo: 'MOCK_R_TEST_1',
      status: 'CLOSED',
      totalAmount: 0,
    })
    prisma.transactionOrder.findUnique.mockResolvedValue({
      ...baseOrder,
      status: 'PENDING',
    })
    prisma.transactionOrder.update.mockResolvedValue({})

    const action = await service.reconcilePendingRecharge(baseOrder)

    expect(action).toBe('MARKED_FAILED')
    expect(prisma.transactionOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    )
    expect(prisma.account.update).not.toHaveBeenCalled()
  })

  it('渠道查询仍为 PENDING：保持现状', async () => {
    queryOrder.mockResolvedValue({
      channelOrderNo: 'MOCK_R_TEST_1',
      status: 'PENDING',
      totalAmount: 0,
    })
    prisma.transactionOrder.findUnique.mockResolvedValue({
      ...baseOrder,
      status: 'PENDING',
    })

    const action = await service.reconcilePendingRecharge(baseOrder)

    expect(action).toBe('STILL_PENDING')
    expect(prisma.account.update).not.toHaveBeenCalled()
    expect(prisma.transactionOrder.update).not.toHaveBeenCalled()
  })

  it('查单抛错：视为未确认，保持 PENDING', async () => {
    queryOrder.mockRejectedValue(new Error('channel timeout'))

    const action = await service.reconcilePendingRecharge(baseOrder)

    expect(action).toBe('STILL_PENDING')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('无渠道单号：直接跳过，不查单', async () => {
    const action = await service.reconcilePendingRecharge({ ...baseOrder, channelOrderNo: null })

    expect(action).toBe('SKIPPED')
    expect(queryOrder).not.toHaveBeenCalled()
  })
})
