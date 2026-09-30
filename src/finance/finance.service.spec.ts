import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { PaymentOrderStatus } from '../common/enums.js'
import { FinanceService } from './finance.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SettlementService } from '../notifications/settlement.service.js'

type PrismaMock = {
  paymentOrder: Record<string, jest.Mock>
  merchant: Record<string, jest.Mock>
  dailySnapshot: Record<string, jest.Mock>
} & Record<string, unknown>

describe('FinanceService', () => {
  let service: FinanceService
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = {
      paymentOrder: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      merchant: {
        findMany: jest.fn(),
      },
      dailySnapshot: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    }

    const module = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SettlementService,
          useValue: {
            getUnsettledSummary: jest.fn().mockResolvedValue({}),
            runDailySettlement: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile()

    service = module.get(FinanceService)
  })

  describe('getDailySummary', () => {
    it('按业务日聚合收单订单：金额计收入、退款额计支出、手续费累加、笔数', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue([
        {
          amount: 10000,
          fee: 100,
          refundAmount: 0,
          paidAt: new Date('2026-06-01T04:00:00.000Z'), // 北京 12:00 → 业务日 06-01
        },
        {
          amount: 5000,
          fee: 50,
          refundAmount: 2000,
          paidAt: new Date('2026-06-02T04:00:00.000Z'), // 北京 12:00 → 业务日 06-02
        },
      ])

      const result = await service.getDailySummary({
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })

      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED] },
          paidAt: {
            gte: new Date('2026-05-31T16:00:00.000Z'),
            lte: new Date('2026-06-02T15:59:59.999Z'),
            not: null,
          },
        },
        select: { amount: true, fee: true, refundAmount: true, paidAt: true },
      })
      expect(result.data).toEqual([
        {
          date: '2026-06-01',
          totalIncome: 10000,
          totalExpense: 0,
          totalFee: 100,
          transactionCount: 1,
          totalIncomeYuan: '100.00',
          totalExpenseYuan: '0.00',
          totalFeeYuan: '1.00',
        },
        {
          date: '2026-06-02',
          totalIncome: 5000,
          totalExpense: 2000,
          totalFee: 50,
          transactionCount: 1,
          totalIncomeYuan: '50.00',
          totalExpenseYuan: '20.00',
          totalFeeYuan: '0.50',
        },
      ])
    })

    it('无订单时返回空数组', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue([])

      const result = await service.getDailySummary({})

      expect(result.data).toEqual([])
    })
  })

  describe('getMerchantSettlements', () => {
    it('按 merchantId 分组统计金额、手续费与结算金额，并补充商户信息', async () => {
      prisma.paymentOrder.groupBy.mockResolvedValue([
        { merchantId: 'm1', _sum: { amount: 50000, fee: 500, refundAmount: 0 }, _count: { id: 10 } },
        { merchantId: 'm2', _sum: { amount: 30000, fee: 300, refundAmount: 0 }, _count: { id: 5 } },
      ])
      prisma.merchant.findMany.mockResolvedValue([
        { id: 'm1', merchantNo: 'M001', merchantName: '商户一' },
        { id: 'm2', merchantNo: 'M002', merchantName: '商户二' },
      ])

      const result = await service.getMerchantSettlements({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      })

      expect(prisma.paymentOrder.groupBy).toHaveBeenCalledWith({
        by: ['merchantId'],
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: {
            gte: new Date('2026-05-31T16:00:00.000Z'),
            lte: new Date('2026-06-30T15:59:59.999Z'),
          },
        },
        _sum: { amount: true, fee: true, refundAmount: true },
        _count: { id: true },
      })
      expect(result.data).toEqual([
        {
          merchantId: 'm1',
          merchantNo: 'M001',
          merchantName: '商户一',
          totalAmount: 50000,
          totalFee: 500,
          totalRefund: 0,
          settledAmount: 49500,
          orderCount: 10,
          totalAmountYuan: '500.00',
          totalFeeYuan: '5.00',
          totalRefundYuan: '0.00',
          settledAmountYuan: '495.00',
        },
        {
          merchantId: 'm2',
          merchantNo: 'M002',
          merchantName: '商户二',
          totalAmount: 30000,
          totalFee: 300,
          totalRefund: 0,
          settledAmount: 29700,
          orderCount: 5,
          totalAmountYuan: '300.00',
          totalFeeYuan: '3.00',
          totalRefundYuan: '0.00',
          settledAmountYuan: '297.00',
        },
      ])
    })

    it('merchantId 为空时应按全部商户统计', async () => {
      prisma.paymentOrder.groupBy.mockResolvedValue([
        { merchantId: 'm1', _sum: { amount: 10000, fee: 100, refundAmount: 0 }, _count: { id: 2 } },
      ])
      prisma.merchant.findMany.mockResolvedValue([
        { id: 'm1', merchantNo: 'M001', merchantName: '商户一' },
      ])

      const result = await service.getMerchantSettlements({})

      expect(prisma.paymentOrder.groupBy).toHaveBeenCalledWith({
        by: ['merchantId'],
        where: { status: PaymentOrderStatus.PAID },
        _sum: { amount: true, fee: true, refundAmount: true },
        _count: { id: true },
      })
      expect(result.data).toHaveLength(1)
    })
  })

  describe('getFeeIncome', () => {
    it('仅按收单订单统计手续费，提现代付手续费下线（withdrawalFee 恒 0）', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue([
        { fee: 100, paidAt: new Date('2026-06-01T04:00:00.000Z') },
        { fee: 200, paidAt: new Date('2026-06-01T06:00:00.000Z') },
        { fee: 50, paidAt: new Date('2026-06-02T04:00:00.000Z') },
      ])

      const result = await service.getFeeIncome({
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })

      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: {
            gte: new Date('2026-05-31T16:00:00.000Z'),
            lte: new Date('2026-06-02T15:59:59.999Z'),
            not: null,
          },
        },
        select: { fee: true, paidAt: true },
      })
      expect(result.data).toEqual([
        {
          date: '2026-06-01',
          paymentFee: 300,
          totalFee: 300,
          paymentFeeYuan: '3.00',
          withdrawalFeeYuan: '0.00',
          totalFeeYuan: '3.00',
        },
        {
          date: '2026-06-02',
          paymentFee: 50,
          totalFee: 50,
          paymentFeeYuan: '0.50',
          withdrawalFeeYuan: '0.00',
          totalFeeYuan: '0.50',
        },
      ])
    })
  })

  describe('generateDailySnapshot', () => {
    it('聚合收单订单（PAID/REFUNDED）：totalAssets 恒 0，收入=交易额、支出=退款额', async () => {
      prisma.paymentOrder.aggregate
        // 第一个聚合：当日全部收单订单（PAID + REFUNDED）
        .mockResolvedValueOnce({
          _sum: { amount: 80000, fee: 700, refundAmount: 10000 },
          _count: { id: 20 },
        })
        // 第二个聚合：当日退款订单
        .mockResolvedValueOnce({ _sum: { refundAmount: 30000 } })
      prisma.dailySnapshot.upsert.mockResolvedValue({
        id: 's1',
        date: '2026-06-01',
        totalAssets: 0,
        totalIncome: 80000,
        totalExpense: 30000,
        totalFee: 700,
        transactionCount: 20,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      })

      const result = await service.generateDailySnapshot('2026-06-01')

      expect(prisma.paymentOrder.aggregate).toHaveBeenCalledTimes(2)
      expect(prisma.dailySnapshot.upsert).toHaveBeenCalledWith({
        where: { date: '2026-06-01' },
        create: {
          date: '2026-06-01',
          totalAssets: 0,
          totalIncome: 80000,
          totalExpense: 30000,
          totalFee: 700,
          transactionCount: 20,
        },
        update: {
          totalAssets: 0,
          totalIncome: 80000,
          totalExpense: 30000,
          totalFee: 700,
          transactionCount: 20,
        },
      })
      expect(result.totalAssetsYuan).toBe('0.00')
      expect(result.totalIncomeYuan).toBe('800.00')
      expect(result.totalExpenseYuan).toBe('300.00')
      expect(result.totalFeeYuan).toBe('7.00')
    })
  })

  describe('getDailySnapshots', () => {
    it('按日期范围过滤快照并转换为元', async () => {
      prisma.dailySnapshot.findMany.mockResolvedValue([
        {
          id: 's1',
          date: '2026-06-02',
          totalAssets: 0,
          totalIncome: 10000,
          totalExpense: 5000,
          totalFee: 100,
          transactionCount: 5,
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          updatedAt: new Date('2026-06-02T00:00:00.000Z'),
        },
        {
          id: 's2',
          date: '2026-06-01',
          totalAssets: 0,
          totalIncome: 8000,
          totalExpense: 3000,
          totalFee: 80,
          transactionCount: 3,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ])

      const result = await service.getDailySnapshots({
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })

      expect(prisma.dailySnapshot.findMany).toHaveBeenCalledWith({
        where: { date: { gte: '2026-06-01', lte: '2026-06-02' } },
        orderBy: { date: 'desc' },
      })
      expect(result.data).toEqual([
        expect.objectContaining({ date: '2026-06-02', totalAssetsYuan: '0.00', totalIncomeYuan: '100.00' }),
        expect.objectContaining({ date: '2026-06-01', totalAssetsYuan: '0.00', totalIncomeYuan: '80.00' }),
      ])
    })

    it('无日期范围时不添加 where 条件', async () => {
      prisma.dailySnapshot.findMany.mockResolvedValue([])

      const result = await service.getDailySnapshots({})

      expect(prisma.dailySnapshot.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { date: 'desc' },
      })
      expect(result.data).toEqual([])
    })
  })
})
