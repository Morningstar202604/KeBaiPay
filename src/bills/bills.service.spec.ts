import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BillsService } from './bills.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { BillDirection, PaymentOrderStatus } from '../common/enums.js'
import { fenToYuan } from '../common/helpers.js'

describe('BillsService', () => {
  let service: BillsService
  type PrismaMock = {
    paymentOrder: { findMany: jest.Mock }
  }

  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = {
      paymentOrder: { findMany: jest.fn() },
    }

    const module = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get(BillsService)
  })

  describe('findByUser 查询账单（paymentOrder 收单订单维度）', () => {
    it('不传 direction 时只按 payerId 查询', async () => {
      const rows = [{ id: 'po1', payerId: 'u1' }]
      prisma.paymentOrder.findMany.mockResolvedValue(rows)

      const result = await service.findByUser('u1')

      expect(result).toBe(rows)
      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
        where: { payerId: 'u1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    })

    it('direction=EXPENSE 时仅返回已支付/已退款订单', async () => {
      const rows = [{ id: 'po2', payerId: 'u1', status: 'PAID' }]
      prisma.paymentOrder.findMany.mockResolvedValue(rows)

      const result = await service.findByUser('u1', BillDirection.EXPENSE)

      expect(result).toBe(rows)
      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
        where: {
          payerId: 'u1',
          status: { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED] },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    })

    it('direction=INCOME 不追加状态过滤（仅 EXPENSE 有语义）', async () => {
      prisma.paymentOrder.findMany.mockResolvedValue([])

      await service.findByUser('u1', BillDirection.INCOME)

      expect(prisma.paymentOrder.findMany).toHaveBeenCalledWith({
        where: { payerId: 'u1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    })
  })

  describe('fenToYuan 金额格式化', () => {
    it('将分转换为元并保留两位小数', () => {
      expect(fenToYuan(100)).toBe('1.00')
      expect(fenToYuan(0)).toBe('0.00')
      expect(fenToYuan(12345)).toBe('123.45')
    })
  })
})
