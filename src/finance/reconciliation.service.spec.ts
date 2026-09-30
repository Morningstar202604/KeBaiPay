import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { ReconciliationService } from './reconciliation.service.js'
import { FinanceService } from './finance.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ReconciliationStatus } from '../common/enums.js'

type PrismaMock = {
  paymentOrder: Record<string, jest.Mock>
  dailySnapshot: Record<string, jest.Mock>
  channelBillCheck: Record<string, jest.Mock>
  reconciliationReport: Record<string, jest.Mock>
} & Record<string, unknown>

type FinanceServiceMock = { generateDailySnapshot: jest.Mock }

describe('ReconciliationService', () => {
  let service: ReconciliationService
  let prisma: PrismaMock
  let financeService: FinanceServiceMock

  beforeEach(async () => {
    prisma = {
      paymentOrder: {
        aggregate: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      dailySnapshot: { findUnique: jest.fn() },
      channelBillCheck: { findFirst: jest.fn(), upsert: jest.fn() },
      reconciliationReport: { upsert: jest.fn() },
    }

    financeService = {
      generateDailySnapshot: jest.fn().mockResolvedValue(undefined),
    }

    const module = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceService, useValue: financeService },
      ],
    }).compile()

    service = module.get(ReconciliationService)
  })

  const stubOrderAggregates = () => {
    // 第一次 aggregate：当日收单订单（PAID+REFUNDED）合计
    prisma.paymentOrder.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 10000, fee: 100 }, _count: { id: 5 } })
      // 第二次 aggregate：当日退款订单
      .mockResolvedValueOnce({ _sum: { refundAmount: 2000 } })
    prisma.paymentOrder.count.mockResolvedValue(3)
  }

  const reportUpsert = () =>
    prisma.reconciliationReport.upsert.mockImplementation((args: unknown) => {
      const query = args as { create: Record<string, unknown> }
      return Promise.resolve({ ...query.create, id: 'r1' })
    })

  describe('runReconciliation 日终对账（收单订单口径）', () => {
    it('快照一致且通道账单 MATCHED → 对账成功', async () => {
      stubOrderAggregates()
      prisma.dailySnapshot.findUnique.mockResolvedValue({
        totalIncome: 10000,
        totalFee: 100,
        transactionCount: 5,
      })
      prisma.channelBillCheck.findFirst.mockResolvedValue({
        channel: 'mock',
        status: 'MATCHED',
        matchedCount: 5,
        mismatchCount: 0,
        billSource: 'MOCK',
      })
      reportUpsert()

      const result = await service.runReconciliation('2026-06-01')

      expect(result.status).toBe(ReconciliationStatus.SUCCESS)
      expect(result.summary.totalRecharge).toBe(10000)
      expect(result.summary.totalFee).toBe(100)
      expect(result.summary.transactionCount).toBe(5)
      expect(result.summary.totalRefund).toBe(2000)
    })

    it('日报收入与订单统计不一致 → 标记 FAILED', async () => {
      stubOrderAggregates()
      prisma.dailySnapshot.findUnique.mockResolvedValue({
        totalIncome: 9999, // 与 10000 不符
        totalFee: 100,
        transactionCount: 5,
      })
      prisma.channelBillCheck.findFirst.mockResolvedValue({
        channel: 'mock',
        status: 'MATCHED',
        matchedCount: 5,
        mismatchCount: 0,
        billSource: 'MOCK',
      })
      reportUpsert()

      const result = await service.runReconciliation('2026-06-01')

      expect(result.status).toBe(ReconciliationStatus.FAILED)
      const diffs = JSON.parse(result.differences as string)
      expect(diffs).toContainEqual(expect.objectContaining({ check: 'snapshot_income_mismatch' }))
    })

    it('快照缺失且补生成成功、通道账单待执行（pending 忽略）→ 仍 SUCCESS', async () => {
      stubOrderAggregates()
      prisma.dailySnapshot.findUnique.mockResolvedValue(null)
      prisma.channelBillCheck.findFirst.mockResolvedValue(null)
      reportUpsert()

      const result = await service.runReconciliation('2026-06-01')

      expect(financeService.generateDailySnapshot).toHaveBeenCalledWith('2026-06-01')
      expect(result.status).toBe(ReconciliationStatus.SUCCESS)
    })

    it('快照缺失且补生成失败 → snapshot_missing 差异 → FAILED', async () => {
      stubOrderAggregates()
      prisma.dailySnapshot.findUnique.mockResolvedValue(null)
      financeService.generateDailySnapshot.mockRejectedValueOnce(new Error('db down'))
      prisma.channelBillCheck.findFirst.mockResolvedValue(null)
      reportUpsert()

      const result = await service.runReconciliation('2026-06-01')

      expect(result.status).toBe(ReconciliationStatus.FAILED)
      const diffs = JSON.parse(result.differences as string)
      expect(diffs).toContainEqual(expect.objectContaining({ check: 'snapshot_missing' }))
    })

    it('通道账单存在但未 MATCHED → FAILED', async () => {
      stubOrderAggregates()
      prisma.dailySnapshot.findUnique.mockResolvedValue({
        totalIncome: 10000,
        totalFee: 100,
        transactionCount: 5,
      })
      prisma.channelBillCheck.findFirst.mockResolvedValue({
        channel: 'mock',
        status: 'MISMATCH',
        matchedCount: 4,
        mismatchCount: 1,
        billSource: 'MOCK',
      })
      reportUpsert()

      const result = await service.runReconciliation('2026-06-01')

      expect(result.status).toBe(ReconciliationStatus.FAILED)
    })
  })

  describe('runChannelReconciliation 通道账单逐笔核对', () => {
    const platformOrders = [
      {
        orderNo: 'O1',
        channelOrderNo: 'C1',
        amount: 1000,
        fee: 10,
        status: 'PAID',
        paidAt: new Date('2026-06-01T04:00:00.000Z'),
      },
      {
        orderNo: 'O2',
        channelOrderNo: 'C2',
        amount: 2000,
        fee: 20,
        status: 'PAID',
        paidAt: new Date('2026-06-01T05:00:00.000Z'),
      },
    ]

    it('mock 账单与平台订单逐笔一致 → MATCHED', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue(platformOrders)
      prisma.channelBillCheck.upsert.mockResolvedValue({})

      const result = await service.runChannelReconciliation('2026-06-01', 'mock', {})

      expect(result.status).toBe('MATCHED')
      expect(result.matchedCount).toBe(2)
      expect(result.mismatchCount).toBe(0)
      expect(prisma.channelBillCheck.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            date: '2026-06-01',
            channel: 'mock',
            status: 'MATCHED',
            matchedCount: 2,
            mismatchCount: 0,
          }),
        }),
      )
    })

    it('注入金额不一致 → amount_mismatch 差异 → MISMATCH', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue(platformOrders)
      prisma.channelBillCheck.upsert.mockResolvedValue({})

      const result = await service.runChannelReconciliation('2026-06-01', 'mock', {
        amountMismatchOrders: 1,
      })

      expect(result.status).toBe('MISMATCH')
      expect(result.mismatchCount).toBe(1)
      expect(result.differences[0].type).toBe('amount_mismatch')
    })

    it('注入平台多记（账单缺单）→ platform_only 差异 → MISMATCH', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue(platformOrders)
      prisma.channelBillCheck.upsert.mockResolvedValue({})

      const result = await service.runChannelReconciliation('2026-06-01', 'mock', {
        missingPlatformOrders: 1,
      })

      expect(result.status).toBe('MISMATCH')
      expect(result.differences.some((d) => d.type === 'platform_only')).toBe(true)
    })

    it('official 模式未传 billText → BadRequest', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue(platformOrders)
      await expect(
        service.runChannelReconciliation('2026-06-01', 'alipay', { billSource: 'official' }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })
})
