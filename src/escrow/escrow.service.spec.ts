import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { EscrowService } from './escrow.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { UsersService } from '../users/users.service.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { RedisService } from '../redis/redis.service.js'
import { EscrowStatus } from '../common/enums.js'
import { KBErrorCodes } from '../common/error-codes.js'

describe('EscrowService', () => {
  let service: EscrowService
  let prisma: any
  let usersService: any
  let riskEngine: any
  let redis: any

  beforeEach(async () => {
    prisma = {
      escrowOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      account: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ availableBalance: 200 }),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn() },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => {
        if (typeof cb === 'function') return cb(prisma)
        const results = []
        for (const op of cb) results.push(await op)
        return results
      }),
    }

    usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn().mockResolvedValue(true),
      checkAndIncrementDailyLimit: jest.fn().mockResolvedValue(undefined),
    }

    riskEngine = {
      check: jest.fn().mockResolvedValue({ blocked: false, rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()
    service = module.get(EscrowService)
  })

  describe('create 创建订单', () => {
    it('金额无效抛 ORDER_AMOUNT_INVALID', async () => {
      await expect(
        service.create('u1', { sellerId: 'u2', amount: 0, subject: 'T' } as any),
      ).rejects.toMatchObject({ message: expect.stringContaining(KBErrorCodes.ORDER_AMOUNT_INVALID) })
    })

    it('不能与自己担保交易', async () => {
      await expect(
        service.create('u1', { sellerId: 'u1', amount: 10, subject: 'T' } as any),
      ).rejects.toMatchObject({ message: expect.stringContaining(KBErrorCodes.ESCROW_CANNOT_SELF) })
    })

    it('买家未实名抛 REAL_NAME_REQUIRED', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'UNVERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      usersService.findById.mockResolvedValueOnce({ id: 'u2' })
      await expect(
        service.create('u1', { sellerId: 'u2', amount: 10, subject: 'T' } as any),
      ).rejects.toThrow(ForbiddenException)
    })

    it('正常创建返回订单', async () => {
      usersService.findById.mockResolvedValueOnce({
        id: 'u1',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      usersService.findById.mockResolvedValueOnce({
        id: 'u2',
        realNameStatus: 'VERIFIED',
        status: 'ACTIVE',
        riskLevel: 'LOW',
      })
      const fakeOrder = { id: 'e1', orderNo: 'E1', status: EscrowStatus.CREATED }
      prisma.escrowOrder.create.mockResolvedValue(fakeOrder)
      const result = await service.create('u1', { sellerId: 'u2', amount: 10, subject: 'T' } as any)
      expect(result).toEqual(fakeOrder)
      expect(prisma.escrowOrder.create).toHaveBeenCalled()
    })
  })

  describe('pay 付款', () => {
    it('订单不存在抛 ESCROW_ORDER_NOT_FOUND', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(null)
      await expect(service.pay('u1', 'E1', 'pwd')).rejects.toThrow(NotFoundException)
    })

    it('非买家调用抛 ESCROW_BUYER_ONLY', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        orderNo: 'E1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.CREATED,
        amount: 1000,
        expiredAt: new Date(Date.now() + 60000),
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.pay('u3', 'E1', 'pwd')).rejects.toThrow(ForbiddenException)
    })

    it('状态非 CREATED 抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        orderNo: 'E1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.PAID,
        amount: 1000,
        expiredAt: new Date(Date.now() + 60000),
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.pay('u1', 'E1', 'pwd')).rejects.toThrow(BadRequestException)
    })

    it('正常付款：余额扣减并冻结', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.account.findUnique.mockReset()
      // 两次完整订单响应：一次给事务外的风控预检读取，一次给事务内主读取
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          orderNo: 'E1',
          buyerId: 'u1',
          sellerId: 'u2',
          status: EscrowStatus.CREATED,
          amount: 1000,
          expiredAt: new Date(Date.now() + 60000),
          buyer: { nickname: 'B' },
          seller: { nickname: 'S' },
        })
        .mockResolvedValueOnce({
          id: 'e1',
          orderNo: 'E1',
          buyerId: 'u1',
          sellerId: 'u2',
          status: EscrowStatus.CREATED,
          amount: 1000,
          expiredAt: new Date(Date.now() + 60000),
          buyer: { nickname: 'B' },
          seller: { nickname: 'S' },
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.PAID })
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 5000,
          frozenBalance: 0,
          status: 'ACTIVE',
        })
        .mockResolvedValueOnce({
          id: 'a1',
          availableBalance: 4000,
          frozenBalance: 1000,
        })
      prisma.account.updateMany.mockResolvedValueOnce({ count: 1 }) // 扣款
      prisma.escrowOrder.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.pay('u1', 'E1', 'pwd')
      expect(result!.status).toBe(EscrowStatus.PAID)
      expect(usersService.verifyPayPassword).toHaveBeenCalledWith('u1', 'pwd')
      expect(prisma.account.updateMany).toHaveBeenCalled()
    })
  })

  describe('ship 发货', () => {
    it('非卖家抛 ESCROW_SELLER_ONLY', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        sellerId: 'u2',
        status: EscrowStatus.PAID,
      })
      await expect(service.ship('u3', 'E1')).rejects.toThrow(ForbiddenException)
    })

    it('非 PAID 状态抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        sellerId: 'u2',
        status: EscrowStatus.CREATED,
      })
      await expect(service.ship('u2', 'E1')).rejects.toThrow(BadRequestException)
    })

    it('正常发货', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          sellerId: 'u2',
          status: EscrowStatus.PAID,
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.SHIPPED })
      const result = await service.ship('u2', 'E1')
      expect(result!.status).toBe(EscrowStatus.SHIPPED)
    })
  })

  describe('confirm 确认收货', () => {
    it('非买家抛 ESCROW_BUYER_ONLY', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.SHIPPED,
        amount: 1000,
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.confirm('u3', 'E1')).rejects.toThrow(ForbiddenException)
    })

    it('非 SHIPPED 状态抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        sellerId: 'u2',
        status: EscrowStatus.CREATED,
        amount: 1000,
        buyer: { nickname: 'B' },
        seller: { nickname: 'S' },
      })
      await expect(service.confirm('u1', 'E1')).rejects.toThrow(BadRequestException)
    })

    it('正常确认：买家冻结扣减 + 卖家余额增加', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          buyerId: 'u1',
          sellerId: 'u2',
          status: EscrowStatus.SHIPPED,
          amount: 1000,
          buyer: { nickname: 'B' },
          seller: { nickname: 'S' },
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.RECEIVED })
      prisma.account.findUnique
        .mockResolvedValueOnce({ id: 'a1', userId: 'u1', frozenBalance: 1000 })
        .mockResolvedValueOnce({ id: 'a2', userId: 'u2', availableBalance: 0 })
        .mockResolvedValueOnce({ id: 'a1', userId: 'u1', frozenBalance: 0 })
      prisma.account.update = jest.fn().mockResolvedValue({ availableBalance: 1000 })

      const result = await service.confirm('u1', 'E1')
      expect(result!.status).toBe(EscrowStatus.RECEIVED)
    })
  })

  describe('cancel 取消', () => {
    it('非 CREATED 状态抛 ESCROW_STATUS_INVALID', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        status: EscrowStatus.PAID,
      })
      await expect(service.cancel('u1', 'E1')).rejects.toThrow(BadRequestException)
    })

    it('CREATED 状态正常取消', async () => {
      prisma.escrowOrder.findUnique.mockReset()
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce({
          id: 'e1',
          buyerId: 'u1',
          status: EscrowStatus.CREATED,
        })
        .mockResolvedValueOnce({ id: 'e1', status: EscrowStatus.CANCELLED })
      const result = await service.cancel('u1', 'E1')
      expect(result!.status).toBe(EscrowStatus.CANCELLED)
    })
  })

  describe('findByOrderNo 查询', () => {
    it('订单不存在抛 ESCROW_ORDER_NOT_FOUND', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(null)
      await expect(service.findByOrderNo('u1', 'E1')).rejects.toThrow(NotFoundException)
    })

    it('非买家/卖家无权查看', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({
        id: 'e1',
        buyerId: 'u1',
        sellerId: 'u2',
      })
      await expect(service.findByOrderNo('u3', 'E1')).rejects.toThrow(ForbiddenException)
    })

    it('买家可查看', async () => {
      const order = { id: 'e1', buyerId: 'u1', sellerId: 'u2' }
      prisma.escrowOrder.findUnique.mockResolvedValue(order)
      const result = await service.findByOrderNo('u1', 'E1')
      expect(result).toEqual(order)
    })
  })

  describe('autoExpire 调度', () => {
    it('无超时订单返回 0', async () => {
      prisma.escrowOrder.findMany.mockResolvedValue([])
      const count = await service.autoExpire()
      expect(count).toBe(0)
    })

    it('有超时订单返回数量', async () => {
      prisma.escrowOrder.findMany.mockResolvedValue([
        { id: 'e1', orderNo: 'E1' },
        { id: 'e2', orderNo: 'E2' },
      ])
      const count = await service.autoExpire()
      expect(count).toBe(2)
      expect(prisma.escrowOrder.updateMany).toHaveBeenCalledTimes(2)
    })
  })

  // ============ 退款链路（v0.3.2 补测） ============

  describe('requestRefund 买家申请退款', () => {
    const shippedOrder = {
      id: 'e1', orderNo: 'E1', buyerId: 'u1', sellerId: 'u2',
      amount: 5000, status: EscrowStatus.SHIPPED, refundReason: null,
    }

    it('订单不存在 -> 404', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(null)
      await expect(service.requestRefund('u1', 'E404', '没收到货')).rejects.toThrow(NotFoundException)
    })

    it('非买家申请 -> 403', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(shippedOrder)
      await expect(service.requestRefund('u9', 'E1', '没收到货')).rejects.toThrow(ForbiddenException)
    })

    it('仅 SHIPPED 状态可申请（PAID 直接退款应走 cancel 语义外路径）', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({ ...shippedOrder, status: EscrowStatus.PAID })
      await expect(service.requestRefund('u1', 'E1', '没收到货')).rejects.toThrow(BadRequestException)
    })

    it('条件更新抢空（并发重复申请）-> ESCROW_ALREADY_HANDLED', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(shippedOrder)
      prisma.escrowOrder.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.requestRefund('u1', 'E1', '没收到货')).rejects.toThrow(
        new RegExp(KBErrorCodes.ESCROW_ALREADY_HANDLED),
      )
    })

    it('正常申请：SHIPPED -> REFUND_REQUESTED 并记录原因', async () => {
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce(shippedOrder)
        .mockResolvedValueOnce({ ...shippedOrder, status: EscrowStatus.REFUND_REQUESTED, refundReason: '没收到货' })
      const result = await service.requestRefund('u1', 'E1', '没收到货')
      expect(result).toMatchObject({ status: EscrowStatus.REFUND_REQUESTED })
      // 守卫条件：只有仍是 SHIPPED 才允许改
      expect(prisma.escrowOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'e1', status: EscrowStatus.SHIPPED }),
          data: expect.objectContaining({ status: EscrowStatus.REFUND_REQUESTED, refundReason: '没收到货' }),
        }),
      )
    })
  })

  describe('resolveRefund 卖家处理退款', () => {
    const requestedOrder = {
      id: 'e1', orderNo: 'E1', buyerId: 'u1', sellerId: 'u2', subject: '测试商品',
      amount: 5000, status: EscrowStatus.REFUND_REQUESTED, refundReason: '没收到货',
      buyer: { nickname: '买家甲' }, seller: { nickname: '卖家乙' },
    }

    it('订单不存在 -> 404', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(null)
      await expect(service.resolveRefund('u2', 'E404', 'APPROVE_REFUND')).rejects.toThrow(NotFoundException)
    })

    it('非卖家处理 -> 403', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(requestedOrder)
      await expect(service.resolveRefund('u9', 'E1', 'APPROVE_REFUND')).rejects.toThrow(ForbiddenException)
    })

    it('状态非 REFUND_REQUESTED -> 400（防止对已处理订单二次裁决）', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue({ ...requestedOrder, status: EscrowStatus.RECEIVED })
      await expect(service.resolveRefund('u2', 'E1', 'APPROVE_REFUND')).rejects.toThrow(BadRequestException)
    })

    it('同意退款：买家冻结 -> 买家可用（带冻结余额守卫），写退款分录与账单', async () => {
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce(requestedOrder)                                  // 订单读取
        .mockResolvedValueOnce({ ...requestedOrder, status: EscrowStatus.REFUNDED }) // 最终返回
      prisma.account.findUnique
        .mockResolvedValueOnce({ id: 'b-acc', availableBalance: 100, frozenBalance: 5000 })  // 买家账户
        .mockResolvedValueOnce({ id: 'b-acc', availableBalance: 5100, frozenBalance: 0 })    // 退款后
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.escrowOrder.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.resolveRefund('u2', 'E1', 'APPROVE_REFUND')
      expect(result).toMatchObject({ status: EscrowStatus.REFUNDED })

      // 买家冻结释放：available +amount / frozen -amount，带 gte 守卫
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'b-acc', frozenBalance: { gte: 5000 } }),
          data: expect.objectContaining({
            availableBalance: { increment: 5000 },
            frozenBalance: { decrement: 5000 },
          }),
        }),
      )
      // 主分录 + 冻结对手分录
      expect(prisma.accountLedger.create).toHaveBeenCalledTimes(2)
      // 买家账单一条（INCOME 退款）
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', direction: 'INCOME', amount: 5000 }),
        }),
      )
      // 卖家不应入账
      expect(prisma.account.update).not.toHaveBeenCalled()
    })

    it('拒绝退款：买家冻结扣减 + 卖家放款入账，状态回到 RECEIVED', async () => {
      prisma.escrowOrder.findUnique
        .mockResolvedValueOnce(requestedOrder)
        .mockResolvedValueOnce({ ...requestedOrder, status: EscrowStatus.RECEIVED })
      prisma.account.findUnique
        .mockResolvedValueOnce({ id: 'b-acc', availableBalance: 100, frozenBalance: 5000 })  // 买家
        .mockResolvedValueOnce({ id: 's-acc', availableBalance: 200 })                       // 卖家
        .mockResolvedValueOnce({ id: 'b-acc', availableBalance: 100, frozenBalance: 0 })     // 更新后的买家
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ id: 's-acc', availableBalance: 5200 })
      prisma.escrowOrder.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.resolveRefund('u2', 'E1', 'REJECT_REFUND')
      expect(result).toMatchObject({ status: EscrowStatus.RECEIVED })

      // 买家冻结扣减（资金离开买家总资产）
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'b-acc', frozenBalance: { gte: 5000 } }),
          data: expect.objectContaining({
            frozenBalance: { decrement: 5000 },
            totalBalance: { decrement: 5000 },
          }),
        }),
      )
      // 卖家放款入账
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's-acc' },
          data: expect.objectContaining({
            availableBalance: { increment: 5000 },
            totalBalance: { increment: 5000 },
          }),
        }),
      )
      // 买家分录 + 卖家分录 + 卖家账单
      expect(prisma.accountLedger.create).toHaveBeenCalledTimes(2)
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u2', type: 'ESCROW_INCOME' }),
        }),
      )
    })

    it('买家冻结余额异常（不足以释放）-> FROZEN_BALANCE_INSUFFICIENT，事务回滚防负余额', async () => {
      prisma.escrowOrder.findUnique.mockResolvedValue(requestedOrder)
      prisma.account.findUnique.mockResolvedValue({ id: 'b-acc', availableBalance: 100, frozenBalance: 10 })
      prisma.account.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.resolveRefund('u2', 'E1', 'APPROVE_REFUND')).rejects.toThrow(
        new RegExp(KBErrorCodes.FROZEN_BALANCE_INSUFFICIENT),
      )
    })
  })

  describe('autoConfirm 自动确认收货调度', () => {
    it('无候选订单返回 0', async () => {
      prisma.escrowOrder.findMany.mockResolvedValue([])
      expect(await service.autoConfirm()).toBe(0)
    })

    it('超时候选逐单调 confirm 放款，计数成功条数', async () => {
      prisma.escrowOrder.findMany.mockResolvedValue([
        { id: 'e1', orderNo: 'E1', buyerId: 'u1' },
        { id: 'e2', orderNo: 'E2', buyerId: 'u1' },
      ])
      const confirmSpy = jest.spyOn(service, 'confirm').mockResolvedValue({} as never)
      const n = await service.autoConfirm()
      expect(n).toBe(2)
      expect(confirmSpy).toHaveBeenCalledTimes(2)
      expect(confirmSpy).toHaveBeenCalledWith('u1', 'E1')
      confirmSpy.mockRestore()
    })

    it('单条 confirm 失败不阻断整批（继续处理后续订单）', async () => {
      prisma.escrowOrder.findMany.mockResolvedValue([
        { id: 'e1', orderNo: 'E1', buyerId: 'u1' },
        { id: 'e2', orderNo: 'E2', buyerId: 'u1' },
      ])
      const confirmSpy = jest.spyOn(service, 'confirm')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({} as never)
      const n = await service.autoConfirm()
      expect(n).toBe(1)
      expect(confirmSpy).toHaveBeenCalledTimes(2)
      confirmSpy.mockRestore()
    })
  })
})
