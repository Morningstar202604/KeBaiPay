import { describe, expect, it, jest } from '@jest/globals'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { RedPacketsService } from './red-packets.service.js'
import { RedPacketStatus, RedPacketType, RedPacketRecordType, RealNameStatus, UserStatus, RiskLevel } from '../common/enums.js'

/**
 * RedPacketsService 单元测试
 *
 * 重点覆盖两类资金风险面：
 * 1. 金额分配算法（二倍均值法的边界：最后一人拿剩余、每人至少 1 分、上限收敛）
 * 2. 领取/过期退回的状态机与资金转移方向（冻结 -> 可用，余额守卫）
 */
describe('RedPacketsService', () => {

  const buildPacket = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'rp1',
    packetNo: 'RP202609140001',
    senderId: 'sender-1',
    amount: 100,
    receivedAmount: 0,
    remainingCount: 1,
    totalCount: 1,
    perAmount: null,
    password: null,
    designatedReceiverId: null,
    status: RedPacketStatus.PENDING,
    type: RedPacketType.LUCKY,
    expiresAt: new Date(Date.now() + 60_000),
    remark: '测试红包',
    receivedAt: null,
    sender: { nickname: '发送者' },
    ...over,
  })

  const buildService = () => {
    const tx = {
      redPacket: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      redPacketRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'rec1' }),
      },
      account: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn(),
    }

    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      redPacket: {
        findUnique: jest.fn().mockResolvedValue({ amount: 100, receivedAmount: 0 }),
      },
    }

    const usersService = {
      findById: jest.fn(),
      verifyPayPassword: jest.fn().mockResolvedValue(undefined),
      checkAndIncrementDailyLimit: jest.fn().mockResolvedValue(undefined),
    }

    const riskEngine = {
      check: jest.fn().mockResolvedValue({ blocked: false, rules: [] }),
      recordTransaction: jest.fn().mockResolvedValue(undefined),
    }

    const redis = { withLock: jest.fn((_key, _ttl, fn) => fn()) }

    const service = new RedPacketsService(
      prisma as never,
      usersService as never,
      riskEngine as never,
      redis as never,
    )
    return { service, tx, prisma, usersService, riskEngine, redis }
  }

  const verifiedSender = {
    id: 'sender-1',
    realNameStatus: RealNameStatus.VERIFIED,
    status: UserStatus.ACTIVE,
    riskLevel: RiskLevel.LOW,
    nickname: '发送者',
  }

  // ============ 金额分配算法 ============

  describe('calculateClaimAmount（私有，经任意访问验证算法边界）', () => {
    const calc = (svc: RedPacketsService, packet: Record<string, unknown>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).calculateClaimAmount(packet)

    it('ORDINARY 返回固定 perAmount', () => {
      const { service } = buildService()
      expect(calc(service, buildPacket({ type: RedPacketType.ORDINARY, perAmount: 33 }))).toBe(33)
    })

    it('EXCLUSIVE / PASSWORD 返回整包金额', () => {
      const { service } = buildService()
      expect(calc(service, buildPacket({ type: RedPacketType.EXCLUSIVE, amount: 88 }))).toBe(88)
      expect(calc(service, buildPacket({ type: RedPacketType.PASSWORD, amount: 66 }))).toBe(66)
    })

    it('LUCKY 最后一人领取全部剩余金额（不截断）', () => {
      const { service } = buildService()
      const p = buildPacket({ type: RedPacketType.LUCKY, amount: 100, receivedAmount: 37, remainingCount: 1 })
      expect(calc(service, p)).toBe(63)
    })

    it('LUCKY 随机金额落在 [1, 二倍均值上界] 且保证后面每人至少 1 分', () => {
      const { service } = buildService()
      // 剩余 100 分 / 剩余 10 人：max = floor(100/10*2)-1 = 19
      const p = buildPacket({ type: RedPacketType.LUCKY, amount: 100, receivedAmount: 0, remainingCount: 10 })
      for (let i = 0; i < 50; i++) {
        const v = calc(service, p)
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(19)
      }
    })

    it('LUCKY 边界：剩余金额恰好等于剩余人数时每人固定 1 分', () => {
      const { service } = buildService()
      // 剩余 5 分 / 5 人：max = floor(5/5*2)-1 = 1 < min -> 返回 1
      const p = buildPacket({ type: RedPacketType.LUCKY, amount: 5, receivedAmount: 0, remainingCount: 5 })
      expect(calc(service, p)).toBe(1)
    })

    it('LUCKY 剩余金额不足以让后面每人 1 分时不再超发（总额守恒）', () => {
      const { service } = buildService()
      // 剩余 3 分 / 10 人：max = floor(3/10*2)-1 = -1 < 1 -> 返回 1，
      // 前面的人少拿，最后一人兜底拿剩余，总额不超发
      const p = buildPacket({ type: RedPacketType.LUCKY, amount: 3, receivedAmount: 0, remainingCount: 10 })
      expect(calc(service, p)).toBe(1)
    })
  })

  // ============ 创建协议约束 ============

  describe('create 协议约束与资金流', () => {
    const baseDto = { amount: 1, payPassword: '123456' } as never

    it('发送者不存在 -> 404', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue(null)
      await expect(service.create('u1', baseDto)).rejects.toThrow(NotFoundException)
    })

    it('未实名 -> 403', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue({ ...verifiedSender, realNameStatus: RealNameStatus.UNVERIFIED })
      await expect(service.create('u1', baseDto)).rejects.toThrow(ForbiddenException)
    })

    it('冻结账户 -> 403', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue({ ...verifiedSender, status: UserStatus.FROZEN })
      await expect(service.create('u1', baseDto)).rejects.toThrow(ForbiddenException)
    })

    it('高风险用户 -> 403', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue({ ...verifiedSender, riskLevel: RiskLevel.HIGH })
      await expect(service.create('u1', baseDto)).rejects.toThrow(ForbiddenException)
    })

    it('LUCKY 金额小于总人数（每人不足 1 分）-> 400', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      const dto = { amount: 0.02, payPassword: '123456', type: RedPacketType.LUCKY, totalCount: 3 } as never
      await expect(service.create('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('ORDINARY perAmount × totalCount ≠ amount -> 400', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      const dto = { amount: 1, payPassword: '123456', type: RedPacketType.ORDINARY, totalCount: 3, perAmount: 0.2 } as never
      // 0.2 元 × 3 = 0.6 元 ≠ 1 元
      await expect(service.create('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('ORDINARY 单人金额超 200 元上限 -> 400', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      const dto = { amount: 300, payPassword: '123456', type: RedPacketType.ORDINARY, totalCount: 1, perAmount: 300 } as never
      await expect(service.create('u1', dto)).rejects.toThrow(/上限 200 元/)
    })

    it('EXCLUSIVE 缺 designatedReceiverId -> 400', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      const dto = { amount: 1, payPassword: '123456', type: RedPacketType.EXCLUSIVE } as never
      await expect(service.create('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('PASSWORD 口令过短 -> 400', async () => {
      const { service, usersService } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      const dto = { amount: 1, payPassword: '123456', type: RedPacketType.PASSWORD, password: 'abc' } as never
      await expect(service.create('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('余额不足 -> 400', async () => {
      const { service, usersService, tx } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      tx.account.findUnique.mockResolvedValue({ id: 'acc1', availableBalance: 50, frozenBalance: 0 })
      const dto = { amount: 100, payPassword: '123456' } as never
      await expect(service.create('u1', dto)).rejects.toThrow(/余额|INSUFFICIENT/)
    })

    it('幂等键命中且属于同一发送者 -> 直接返回已有红包', async () => {
      const { service, usersService, tx } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      const existing = { id: 'rp-exist', senderId: 'u1', packetNo: 'RP1' }
      tx.redPacket.findUnique.mockResolvedValueOnce(existing)
      const dto = { amount: 1, payPassword: '123456', idempotencyKey: 'idem-1' } as never
      await expect(service.create('u1', dto)).resolves.toBe(existing)
    })

    it('幂等键属于其他发送者 -> 400（防撞键劫持）', async () => {
      const { service, usersService, tx } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      tx.redPacket.findUnique.mockResolvedValueOnce({ id: 'rp-x', senderId: 'someone-else' })
      const dto = { amount: 1, payPassword: '123456', idempotencyKey: 'idem-1' } as never
      await expect(service.create('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('成功创建：金额从可用余额划入冻结，并写主分录+冻结对手分录', async () => {
      const { service, usersService, tx } = buildService()
      usersService.findById.mockResolvedValue(verifiedSender)
      tx.redPacket.findUnique.mockResolvedValue(null)
      tx.account.findUnique
        .mockResolvedValueOnce({ id: 'acc1', availableBalance: 10_00, frozenBalance: 0 })
        .mockResolvedValueOnce({ id: 'acc1', availableBalance: 9_00, frozenBalance: 10_00 })
      tx.redPacket.create.mockResolvedValue({ id: 'rp-new', packetNo: 'RP2' })
      tx.account.updateMany.mockResolvedValue({ count: 1 })

      const dto = { amount: 10, payPassword: '123456', remark: '新年快乐' } as never
      const packet = await service.create('sender-1', dto)
      expect(packet).toMatchObject({ id: 'rp-new' })

      // 扣款：条件更新带余额守卫
      expect(tx.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ availableBalance: { gte: 1000 } }),
          data: expect.objectContaining({
            availableBalance: { decrement: 1000 },
            frozenBalance: { increment: 1000 },
          }),
        }),
      )
      // 主分录 + 冻结对手分录（复式记账）
      expect(tx.accountLedger.create).toHaveBeenCalledTimes(2)
    })
  })

  // ============ 领取状态机 ============

  describe('receive 状态机与资金转移', () => {
    const buildReceiveEnv = (packet: Record<string, unknown>) => {
      const env = buildService()
      env.usersService.findById.mockImplementation(async (id: string) =>
        id === 'sender-1'
          ? verifiedSender
          : { id, realNameStatus: RealNameStatus.VERIFIED, status: UserStatus.ACTIVE, riskLevel: RiskLevel.LOW, nickname: '领取者' },
      )
      env.tx.redPacket.findUnique.mockResolvedValue(packet)
      return env
    }

    it('红包不存在 -> 404', async () => {
      const env = buildReceiveEnv(buildPacket())
      env.prisma.redPacket.findUnique.mockResolvedValue(null)
      env.tx.redPacket.findUnique.mockResolvedValue(null)
      await expect(env.service.receive('r1', 'RP404')).rejects.toThrow(NotFoundException)
    })

    it('自己领自己的红包 -> 400', async () => {
      const env = buildReceiveEnv(buildPacket())
      await expect(env.service.receive('sender-1', 'RP202609140001')).rejects.toThrow(/自己/)
    })

    it('过期红包 -> 400', async () => {
      const env = buildReceiveEnv(buildPacket({ expiresAt: new Date(Date.now() - 1000) }))
      await expect(env.service.receive('r1', 'RP202609140001')).rejects.toThrow(/过期|EXPIRED/)
    })

    it('已被领完（RECEIVED）-> 400', async () => {
      const env = buildReceiveEnv(buildPacket({ status: RedPacketStatus.RECEIVED }))
      await expect(env.service.receive('r1', 'RP202609140001')).rejects.toThrow(BadRequestException)
    })

    it('EXCLUSIVE：非指定人 -> 403', async () => {
      const env = buildReceiveEnv(buildPacket({ type: RedPacketType.EXCLUSIVE, designatedReceiverId: 'r2' }))
      await expect(env.service.receive('r1', 'RP202609140001')).rejects.toThrow(ForbiddenException)
    })

    it('PASSWORD：缺口令 / 错口令 -> 400', async () => {
      const env = buildReceiveEnv(buildPacket({ type: RedPacketType.PASSWORD, password: '8888' }))
      await expect(env.service.receive('r1', 'RP202609140001', {})).rejects.toThrow(/口令|PASSWORD/)
      await expect(env.service.receive('r1', 'RP202609140001', { password: '0000' })).rejects.toThrow(BadRequestException)
    })

    it('重复领取同一红包 -> 幂等返回与正常领取一致的富对象形状', async () => {
      const env = buildReceiveEnv(buildPacket())
      env.tx.redPacketRecord.findFirst.mockResolvedValue({ id: 'rec-old', amount: 50 })
      const result = await env.service.receive('r1', 'RP202609140001')
      // 幂等路径返回统一富对象（packetNo/amount/type/状态），不再回吐裸 record
      expect(result).toMatchObject({
        packetNo: 'RP202609140001',
        amount: 50,
        type: 'LUCKY',
      })
      expect(result).not.toHaveProperty('id')
      // 不应再走扣减
      expect(env.tx.redPacket.updateMany).not.toHaveBeenCalled()
    })

    it('成功领取：领取人入账、发送者冻结扣减，双方各写分录与账单', async () => {
      const packet = buildPacket({ type: RedPacketType.ORDINARY, perAmount: 50, amount: 50, remainingCount: 1 })
      const env = buildReceiveEnv(packet)
      env.tx.redPacket.updateMany.mockResolvedValue({ count: 1 })
      env.tx.account.findUnique
        .mockResolvedValueOnce({ id: 'r-acc', availableBalance: 0 })          // receiver
        .mockResolvedValueOnce({ id: 's-acc', availableBalance: 0, frozenBalance: 50 }) // sender
        .mockResolvedValueOnce({ id: 's-acc', availableBalance: 0, frozenBalance: 0 }) // sender after release
      env.tx.account.update.mockResolvedValue({ id: 'r-acc', availableBalance: 50 })
      env.tx.account.updateMany.mockResolvedValue({ count: 1 })

      const result = await env.service.receive('r1', 'RP202609140001')
      expect(result).toMatchObject({ amount: 50, status: RedPacketStatus.RECEIVED })

      // 领取人入账
      expect(env.tx.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r-acc' },
          data: expect.objectContaining({ availableBalance: { increment: 50 }, totalBalance: { increment: 50 } }),
        }),
      )
      // 发送者冻结释放带守卫
      expect(env.tx.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 's-acc', frozenBalance: { gte: 50 } }),
          data: expect.objectContaining({
            frozenBalance: { decrement: 50 },
            totalBalance: { decrement: 50 },
          }),
        }),
      )
      // 双方账单
      expect(env.tx.bill.create).toHaveBeenCalledTimes(2)
    })

    it('乐观锁抢空（remainingCount 已为 0）-> 400', async () => {
      const env = buildReceiveEnv(buildPacket())
      env.tx.redPacket.updateMany.mockResolvedValue({ count: 0 })
      env.tx.account.findUnique.mockResolvedValue({ id: 'r-acc', availableBalance: 0 })
      await expect(env.service.receive('r1', 'RP202609140001')).rejects.toThrow(BadRequestException)
    })
  })

  // ============ 过期退回 ============

  describe('expireReturn 过期退款', () => {
    it('已领完（RECEIVED）-> 原样返回，不退款', async () => {
      const { service, tx } = buildService()
      const p = buildPacket({ status: RedPacketStatus.RECEIVED })
      tx.redPacket.findUnique.mockResolvedValue(p)
      const result = await service.expireReturn('rp1')
      expect(result).toBe(p)
      expect(tx.account.updateMany).not.toHaveBeenCalled()
    })

    it('部分领取 -> 仅退回剩余冻结部分', async () => {
      const { service, tx } = buildService()
      const p = buildPacket({ status: RedPacketStatus.PARTIALLY_RECEIVED, amount: 100, receivedAmount: 60 })
      tx.redPacket.findUnique
        .mockResolvedValueOnce(p)   // expireReturn 读
        .mockResolvedValueOnce(p)   // returnPacket 读
      tx.redPacket.updateMany.mockResolvedValueOnce({ count: 1 })   // 状态锁
      tx.account.findUnique.mockResolvedValue({ id: 's-acc', availableBalance: 0, frozenBalance: 40 })
      tx.account.updateMany.mockResolvedValue({ count: 1 })

      await service.expireReturn('rp1')
      // 退回金额 = 100 - 60 = 40
      expect(tx.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ frozenBalance: { gte: 40 } }),
          data: expect.objectContaining({
            availableBalance: { increment: 40 },
            frozenBalance: { decrement: 40 },
          }),
        }),
      )
      // 退回记录 + 主分录 + 冻结对手分录 + 账单
      expect(tx.redPacketRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 40, type: RedPacketRecordType.RETURN }) }),
      )
      expect(tx.accountLedger.create).toHaveBeenCalledTimes(2)
      expect(tx.bill.create).toHaveBeenCalledTimes(1)
    })

    it('发送者冻结余额异常（不足退款）-> 400 拒绝，防止负余额', async () => {
      const { service, tx } = buildService()
      const p = buildPacket({ status: RedPacketStatus.PENDING, amount: 100, receivedAmount: 0 })
      tx.redPacket.findUnique.mockResolvedValue(p)
      tx.redPacket.updateMany.mockResolvedValueOnce({ count: 1 })
      tx.account.findUnique.mockResolvedValue({ id: 's-acc', availableBalance: 0, frozenBalance: 10 })
      tx.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.expireReturn('rp1')).rejects.toThrow(BadRequestException)
    })
  })
})
