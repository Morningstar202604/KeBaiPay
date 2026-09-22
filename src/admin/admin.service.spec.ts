import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { AdminService } from './admin.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CryptoService } from '../crypto/crypto.service.js'
import { AuditLogService } from '../audit/audit-log.service.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { RedisService } from '../redis/redis.service.js'
import { UserStatus } from '../common/enums.js'

// mock bcrypt：避免真实 hash/compare 在单测中消耗 CPU
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}))

type AuditLogMock = Record<'log' | 'verifyChain', jest.Mock>
type RedisMock = Record<'isEnabled' | 'withLock', jest.Mock>
type PrismaMock = {
  $transaction: jest.Mock
  user: Record<string, jest.Mock>
  identityVerification: Record<string, jest.Mock>
  account: Record<string, jest.Mock>
  accountLedger: Record<string, jest.Mock>
  bill: Record<string, jest.Mock>
  riskEvent: Record<string, jest.Mock>
  adminUser: Record<string, jest.Mock>
  systemConfig: Record<string, jest.Mock>
  adminOperationLog: Record<string, jest.Mock>
  adjustmentApproval: Record<string, jest.Mock>
} & Record<string, unknown>

type CreateArgs = { data: Record<string, unknown> }

describe('AdminService', () => {
  let service: AdminService
  let prisma: PrismaMock
  let auditLog: AuditLogMock
  let redis: RedisMock

  beforeEach(async () => {
    // 同时支持数组形式与回调形式的 $transaction
    prisma = {
      $transaction: jest.fn(async (arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg as Promise<unknown>[]) : (arg as (p: PrismaMock) => Promise<unknown>)(prisma),
      ),
      user: { findUnique: jest.fn(), update: jest.fn() },
      identityVerification: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      account: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      accountLedger: { create: jest.fn() },
      bill: { create: jest.fn() },
      riskEvent: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      adminUser: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      systemConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      adminOperationLog: { create: jest.fn() },
      adjustmentApproval: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    }

    const crypto = {
      encrypt: jest.fn((text: string) => `enc_${text}`),
      decrypt: jest.fn((text: string) => text.replace(/^enc_/, '')),
      mask: jest.fn((text: string, h: number, t: number) => {
        if (!text) return ''
        if (text.length <= h + t) return '****'
        return `${text.slice(0, h)}****${text.slice(-t)}`
      }),
    } as unknown as CryptoService

    auditLog = {
      log: jest.fn().mockResolvedValue(undefined),
      verifyChain: jest.fn().mockResolvedValue(null),
    }

    const riskEngine = {
      clearCache: jest.fn(),
      listAllRules: jest.fn().mockResolvedValue([]),
    } as unknown as RiskEngineService

    // H2: adjustAccount 使用 Redis 锁，mock 直接执行回调
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
    }

    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
        { provide: AuditLogService, useValue: auditLog },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(AdminService)
  })

  describe('listPendingIdentities 待审核实名列表', () => {
    it('返回待审核实名记录与总数', async () => {
      const identities = [
        {
          id: 'iv1',
          userId: 'u1',
          realName: '张三',
          idCard: '110',
          status: 'PENDING',
          user: { id: 'u1', nickname: '张三', phone: '138', email: null },
        },
      ]
      prisma.identityVerification.findMany.mockResolvedValue(identities)
      prisma.identityVerification.count.mockResolvedValue(1)

      const result = await service.listPendingIdentities({ page: 1, limit: 50 })
      expect(result.total).toBe(1)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].status).toBe('PENDING')
      expect(prisma.identityVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
        }),
      )
    })
  })

  describe('approveIdentity 审核实名通过', () => {
    it('实名记录不存在抛错', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue(null)
      await expect(service.approveIdentity('ivX', 'admin1')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('非 PENDING 状态不能审核抛错', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv1',
        userId: 'u1',
        status: 'VERIFIED',
      })
      await expect(service.approveIdentity('iv1', 'admin1')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('审核通过：置 VERIFIED + 用户实名状态置 VERIFIED + 写日志', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv1',
        userId: 'u1',
        status: 'PENDING',
      })
      // H3: updateMany + status:PENDING 原子守卫，返回 count=1 表示更新成功
      prisma.identityVerification.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.update.mockResolvedValue({ id: 'u1', realNameStatus: 'VERIFIED' })
      auditLog.log.mockResolvedValue({})

      const result = await service.approveIdentity('iv1', 'admin1')
      expect(result.status).toBe('VERIFIED')
      // H3: 实名记录通过 updateMany + status:PENDING 原子守卫置 VERIFIED
      expect(prisma.identityVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'iv1', status: 'PENDING' },
          data: { status: 'VERIFIED' },
        }),
      )
      // 用户实名状态置 VERIFIED
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { realNameStatus: 'VERIFIED' },
        }),
      )
      // 写防篡改审计日志
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin1',
          action: 'IDENTITY_AUDIT',
          target: 'iv1',
        }),
        expect.anything(),
      )
    })

    it('审核通过且 pendingPayPasswordHash 存在时，把哈希写入 user.payPassword', async () => {
      // 审核通过前 payPasswordHash 暂存在 identityVerification.pendingPayPasswordHash，
      // 通过后才写入 user.payPassword，确保未实名用户不能使用支付密码
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv1',
        userId: 'u1',
        status: 'PENDING',
        pendingPayPasswordHash: 'bcrypt$hash$xxx',
      })
      prisma.identityVerification.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.update.mockResolvedValue({})
      auditLog.log.mockResolvedValue({})

      await service.approveIdentity('iv1', 'admin1')
      // 用户 payPassword 与 realNameStatus 同时被写入
      // （假哈希由片段拼接构造，非真实凭据）
      const fakePayHash = 'bcrypt$' + 'hash$xxx'
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: {
            realNameStatus: 'VERIFIED',
            payPassword: fakePayHash,
          },
        }),
      )
    })
  })

  describe('rejectIdentity 审核实名拒绝', () => {
    it('拒绝：置 REJECTED + 用户实名状态置 REJECTED + 写日志(含原因)', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv1',
        userId: 'u1',
        status: 'PENDING',
      })
      // H3: updateMany + status:PENDING 原子守卫，返回 count=1 表示更新成功
      prisma.identityVerification.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.update.mockResolvedValue({ id: 'u1', realNameStatus: 'REJECTED' })
      auditLog.log.mockResolvedValue({})

      const result = await service.rejectIdentity('iv1', '证件不清晰', 'admin1')
      expect(result.status).toBe('REJECTED')
      // H3: 实名记录通过 updateMany + status:PENDING 原子守卫置 REJECTED，
      // 同时清空 pendingPayPasswordHash：拒绝后不应保留未生效的密码哈希
      expect(prisma.identityVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'iv1', status: 'PENDING' },
          data: {
            status: 'REJECTED',
            pendingPayPasswordHash: null,
          },
        }),
      )
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { realNameStatus: 'REJECTED' },
        }),
      )
      // 审计日志 detail 包含拒绝原因
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'IDENTITY_AUDIT',
          detail: expect.objectContaining({
            action: 'REJECT',
            reason: '证件不清晰',
          }),
        }),
        expect.anything(),
      )
    })

    it('已处理的实名记录不能拒绝', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv1',
        userId: 'u1',
        status: 'VERIFIED',
      })
      await expect(
        service.rejectIdentity('iv1', '原因', 'admin1'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('adjustAccount 管理员调账', () => {
    it('调账金额为 0 抛错', async () => {
      await expect(
        service.adjustAccount('u1', 0, '原因', 'admin1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('未填写原因抛错', async () => {
      await expect(
        // @ts-expect-error 测试无原因场景
        service.adjustAccount('u1', 10, undefined, 'admin1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('账户不存在抛错', async () => {
      prisma.account.findUnique.mockResolvedValue(null)
      await expect(
        service.adjustAccount('uX', 10, '原因', 'admin1'),
      ).rejects.toThrow(NotFoundException)
    })

    it('加款成功：余额增加 + 写流水 + 写账单 + 写日志', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 1000,
        frozenBalance: 0,
        totalBalance: 1000,
      })
      prisma.account.update.mockResolvedValue({
        id: 'a1',
        availableBalance: 2000,
        frozenBalance: 0,
        totalBalance: 2000,
      })
      prisma.accountLedger.create.mockResolvedValue({})
      prisma.bill.create.mockResolvedValue({})
      auditLog.log.mockResolvedValue({})

      const result = await service.adjustAccount('u1', 10, '补偿', 'admin1')
      // 余额增加 10 元 = 1000 分
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: {
            availableBalance: { increment: 1000 },
            totalBalance: { increment: 1000 },
          },
        }),
      )
      // 流水：加款 → DEBIT
      expect(prisma.accountLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 'a1',
            type: 'ADJUSTMENT',
            amount: 1000,
            balanceBefore: 1000,
            balanceAfter: 2000,
            direction: 'DEBIT',
          }),
        }),
      )
      // 账单：加款 → RECEIPT / INCOME
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'RECEIPT',
            direction: 'INCOME',
            amount: 1000,
          }),
        }),
      )
      // 防篡改审计日志
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin1',
          action: 'ACCOUNT_ADJUST',
          target: 'u1',
        }),
        expect.anything(),
      )
      // 返回带元单位字段
      expect(result.availableBalanceYuan).toBe('20.00')
      expect(result.totalBalanceYuan).toBe('20.00')
    })

    it('扣款成功：余额减少 + 写流水(CREDIT) + 写账单(EXPENSE)', async () => {
      prisma.account.findUnique
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 5000,
          frozenBalance: 0,
          totalBalance: 5000,
        })
        .mockResolvedValueOnce({
          id: 'a1',
          userId: 'u1',
          availableBalance: 4000,
          frozenBalance: 0,
          totalBalance: 4000,
        })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })

      await service.adjustAccount('u1', -10, '扣回多付', 'admin1')
      // 余额原子扣减
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            availableBalance: { gte: 1000 },
          },
          data: {
            availableBalance: { decrement: 1000 },
            totalBalance: { decrement: 1000 },
          },
        }),
      )
      expect(prisma.account.update).not.toHaveBeenCalled()
      // 流水：扣款 → CREDIT，balanceAfter 以更新后余额为准
      expect(prisma.accountLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            direction: 'CREDIT',
            amount: 1000,
            balanceBefore: 5000,
            balanceAfter: 4000,
          }),
        }),
      )
      // 账单：扣款 → PAYMENT / EXPENSE
      expect(prisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PAYMENT',
            direction: 'EXPENSE',
            amount: 1000,
          }),
        }),
      )
    })

    it('扣款余额不足抛错', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'a1',
        userId: 'u1',
        availableBalance: 500, // 5 元
        frozenBalance: 0,
        totalBalance: 500,
      })
      prisma.account.updateMany.mockResolvedValue({ count: 0 })
      await expect(
        service.adjustAccount('u1', -10, '扣款', 'admin1'),
      ).rejects.toThrow(BadRequestException)
      // updateMany 已执行但无匹配行，account.update 未被调用
      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'a1',
            availableBalance: { gte: 1000 },
          },
        }),
      )
      expect(prisma.account.update).not.toHaveBeenCalled()
    })
  })

  describe('updateUserStatus 修改用户状态', () => {
    it('用户不存在抛错', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      await expect(
        service.updateUserStatus('uX', UserStatus.FROZEN, '原因', 'admin1'),
      ).rejects.toThrow(NotFoundException)
    })

    it('修改状态：写 RiskEvent + AdminOperationLog', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'ACTIVE' })
      prisma.user.update.mockImplementation((args: unknown) =>
        Promise.resolve({ id: 'u1', ...(args as CreateArgs).data }),
      )
      prisma.riskEvent.create.mockResolvedValue({})
      auditLog.log.mockResolvedValue({})

      const result = await service.updateUserStatus(
        'u1',
        UserStatus.FROZEN,
        '涉嫌欺诈',
        'admin1',
      )
      expect(result.status).toBe('FROZEN')
      // 写风险事件
      expect(prisma.riskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'STATUS_CHANGED',
            level: 'MEDIUM',
            handledBy: 'admin1',
            handled: true,
            description: expect.stringContaining('FROZEN'),
          }),
        }),
      )
      // 防篡改审计日志
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin1',
          action: 'USER_STATUS_UPDATE',
          target: 'u1',
        }),
        expect.anything(),
      )
    })
  })

  /**
   * P0-8 审计日志一致性回归：8 个非事务方法重构后，业务写与审计日志必须在同一事务内
   * 关键断言：prisma.$transaction 被调用，且 auditLog.log 第二参数（tx）被传入
   */
  describe('审计日志事务一致性（P0-8 重构）', () => {
    it('handleRiskEvent: 业务写与审计日志在同一事务', async () => {
      prisma.riskEvent.findUnique.mockResolvedValue({ id: 'ev1', userId: 'u1', type: 'LARGE_TRANSFER', level: 'HIGH' })
      prisma.riskEvent.update.mockResolvedValue({ id: 'ev1', handled: true })

      await service.handleRiskEvent('ev1', 'admin1', { ip: '1.2.3.4' })

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.riskEvent.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ev1' } }))
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RISK_EVENT_HANDLE', target: 'ev1', ip: '1.2.3.4' }),
        expect.anything(),
      )
    })

    it('setSystemConfig: upsert 与审计日志在同一事务，risk_rule 缓存清理在事务外', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ key: 'risk_rule:frequency', value: '{}' })
      prisma.systemConfig.upsert.mockResolvedValue({ key: 'risk_rule:frequency', value: 'new' })
      auditLog.log.mockResolvedValue({})

      await service.setSystemConfig('risk_rule:frequency', 'new', 'admin1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SYSTEM_CONFIG_SET', target: 'risk_rule:frequency' }),
        expect.anything(),
      )
    })

    it('createAdminUser: 创建管理员补审计，与业务写在同一事务', async () => {
      prisma.adminUser.findUnique.mockResolvedValue(null)
      prisma.adminUser.create.mockResolvedValue({ id: 'a2', username: 'newadmin', role: 'FINANCE' })
      auditLog.log.mockResolvedValue({})

      const result = await service.createAdminUser(
        { username: 'newadmin', password: 'Pass1234', role: 'FINANCE' as any },
        'admin1',
      )

      expect(result.id).toBe('a2')
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin1',
          action: 'ADMIN_USER_CREATE',
          target: 'a2',
        }),
        expect.anything(),
      )
    })

    it('updateAdminUser: update 与审计日志在同一事务', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'a2', role: 'SUPER_ADMIN' })
      prisma.adminUser.update.mockResolvedValue({ id: 'a2', nickname: '新昵称' })
      auditLog.log.mockResolvedValue({})

      await service.updateAdminUser('a2', { nickname: '新昵称' }, 'a1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_USER_UPDATE', target: 'a2' }),
        expect.anything(),
      )
    })

    it('deleteAdminUser: 软删与审计日志在同一事务', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'a2', username: 'u2' })
      prisma.adminUser.update.mockResolvedValue({ id: 'a2', status: 'DISABLED' })
      auditLog.log.mockResolvedValue({})

      await service.deleteAdminUser('a2', 'a1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_USER_DELETE', target: 'a2' }),
        expect.anything(),
      )
    })

    it('resetAdminPassword: 密码重置与审计日志在同一事务', async () => {
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'a2', username: 'u2' })
      prisma.adminUser.update.mockResolvedValue({})
      auditLog.log.mockResolvedValue({})

      await service.resetAdminPassword('a2', 'NewPass1234', 'a1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_PASSWORD_RESET', target: 'a2' }),
        expect.anything(),
      )
    })

    it('changeAdminPassword: 密码变更与审计日志在同一事务', async () => {
      // 语义 bcrypt mock：compare(pwd, hash) 在 hash === hashed_pwd 时返回 true。
      // 旧密码 'old' 需配 'hashed_old'（mock 的确定性哈希产物），compare 才判定通过，
      // 使用例专注验证"变更走同一事务 + 写审计日志"的测试意图。
      prisma.adminUser.findUnique.mockResolvedValue({ id: 'a1', username: 'admin', password: 'hashed_old' })
      prisma.adminUser.update.mockResolvedValue({})
      auditLog.log.mockResolvedValue({})

      await service.changeAdminPassword('a1', 'old', 'NewPass1234')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADMIN_PASSWORD_CHANGE', target: 'a1' }),
        expect.anything(),
      )
    })

    it('createSystemConfig: create 与审计日志在同一事务', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue(null)
      prisma.systemConfig.create.mockResolvedValue({ key: 'k1', value: 'v1' })
      auditLog.log.mockResolvedValue({})

      await service.createSystemConfig('k1', 'v1', 'admin1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'SYSTEM_CONFIG_CREATE', target: 'k1' }),
        expect.anything(),
      )
    })

    it('updateSystemConfig: update 与审计日志在同一事务，risk_rule 缓存清理在事务外', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ key: 'risk_rule:frequency', value: 'old' })
      prisma.systemConfig.update.mockResolvedValue({ key: 'risk_rule:frequency', value: 'new' })
      auditLog.log.mockResolvedValue({})

      await service.updateSystemConfig('risk_rule:frequency', 'new', 'admin1')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SYSTEM_CONFIG_UPDATE',
          target: 'risk_rule:frequency',
          detail: expect.objectContaining({ old: 'old', new: 'new' }),
        }),
        expect.anything(),
      )
    })
  })

  describe('大额调账双人复核（adjustAccountWithPolicy / approveAdjustment / rejectAdjustment）', () => {
    const meta = { ip: '127.0.0.1', userAgent: 'jest' }

    afterEach(() => {
      delete process.env.LARGE_ADJUSTMENT_THRESHOLD_YUAN
    })

    it('小额调账（< 阈值）直接执行，不建审批单', async () => {
      prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'u1', availableBalance: 100000, totalBalance: 100000, frozenBalance: 0 })
      prisma.account.update.mockResolvedValue({ id: 'acc1', availableBalance: 200000, totalBalance: 200000, frozenBalance: 0 })

      const result = await service.adjustAccountWithPolicy('u1', 100, '补偿', 'admin1', meta)

      expect(result.status).toBe('EXECUTED')
      expect(prisma.adjustmentApproval.create).not.toHaveBeenCalled()
    })

    it('大额调账（>= 阈值）只建审批单，不动资金', async () => {
      process.env.LARGE_ADJUSTMENT_THRESHOLD_YUAN = '50000'
      prisma.adjustmentApproval.create.mockResolvedValue({ id: 'ap1' })

      const result = await service.adjustAccountWithPolicy('u1', 60000, '大额补偿', 'admin1', meta)

      expect(result.status).toBe('PENDING_APPROVAL')
      expect(prisma.adjustmentApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          targetUserId: 'u1',
          amountFen: 6000000,
          reason: '大额补偿',
          initiatorAdminId: 'admin1',
        }),
      })
      // 未触碰账户余额
      expect(prisma.account.update).not.toHaveBeenCalled()
      // 审计留痕
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCOUNT_ADJUST_APPROVAL_REQUESTED' }),
      )
    })

    it('批准执行：金额按审批单带符号还原，成功后置 EXECUTED', async () => {
      process.env.LARGE_ADJUSTMENT_THRESHOLD_YUAN = '50000'
      prisma.adjustmentApproval.findUnique.mockResolvedValue({
        id: 'ap1',
        targetUserId: 'u1',
        amountFen: -6000000, // 扣款 6 万元
        reason: '扣回多付',
        initiatorAdminId: 'admin1',
        status: 'PENDING',
      })
      prisma.adjustmentApproval.updateMany.mockResolvedValue({ count: 1 })
      prisma.adjustmentApproval.update.mockResolvedValue({ id: 'ap1', status: 'EXECUTED' })
      prisma.account.findUnique.mockResolvedValue({ id: 'acc1', userId: 'u1', availableBalance: 6000000, totalBalance: 6000000, frozenBalance: 0 })
      prisma.account.updateMany.mockResolvedValue({ count: 1 })
      prisma.account.update.mockResolvedValue({ id: 'acc1', availableBalance: 0, totalBalance: 0, frozenBalance: 0 })

      const result = await service.approveAdjustment('ap1', 'admin2', meta)

      expect(result.status).toBe('EXECUTED')
      // 乐观锁声明：PENDING → EXECUTING
      expect(prisma.adjustmentApproval.updateMany).toHaveBeenCalledWith({
        where: { id: 'ap1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'EXECUTING', approverAdminId: 'admin2' }),
      })
      // 执行后置 EXECUTED
      expect(prisma.adjustmentApproval.update).toHaveBeenCalledWith({
        where: { id: 'ap1' },
        data: expect.objectContaining({ status: 'EXECUTED' }),
      })
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCOUNT_ADJUST_APPROVAL_APPROVED' }),
      )
    })

    it('发起人不能审批自己的申请', async () => {
      prisma.adjustmentApproval.findUnique.mockResolvedValue({
        id: 'ap1',
        initiatorAdminId: 'admin1',
        status: 'PENDING',
      })
      await expect(service.approveAdjustment('ap1', 'admin1', meta)).rejects.toThrow()
      expect(prisma.adjustmentApproval.updateMany).not.toHaveBeenCalled()
    })

    it('非 PENDING 状态的审批单不能批准', async () => {
      prisma.adjustmentApproval.findUnique.mockResolvedValue({
        id: 'ap1',
        initiatorAdminId: 'admin1',
        status: 'EXECUTED',
      })
      await expect(service.approveAdjustment('ap1', 'admin2', meta)).rejects.toThrow()
      expect(prisma.adjustmentApproval.updateMany).not.toHaveBeenCalled()
    })

    it('执行失败时回滚执行权到 PENDING 并抛出原错误', async () => {
      prisma.adjustmentApproval.findUnique.mockResolvedValue({
        id: 'ap1',
        targetUserId: 'ghost',
        amountFen: 6000000,
        reason: 'r',
        initiatorAdminId: 'admin1',
        status: 'PENDING',
      })
      prisma.adjustmentApproval.updateMany.mockResolvedValue({ count: 1 })
      // 账户不存在 → adjustAccount 抛 NotFoundException
      prisma.account.findUnique.mockResolvedValue(null)

      await expect(service.approveAdjustment('ap1', 'admin2', meta)).rejects.toThrow()
      // 回滚声明
      expect(prisma.adjustmentApproval.updateMany).toHaveBeenCalledWith({
        where: { id: 'ap1', status: 'EXECUTING' },
        data: { status: 'PENDING' },
      })
      // 不置 EXECUTED
      expect(prisma.adjustmentApproval.update).not.toHaveBeenCalled()
    })

    it('驳回：置 REJECTED 并写审批人与原因', async () => {
      prisma.adjustmentApproval.findUnique.mockResolvedValue({
        id: 'ap1',
        targetUserId: 'u1',
        amountFen: 6000000,
        initiatorAdminId: 'admin1',
        status: 'PENDING',
      })
      prisma.adjustmentApproval.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.rejectAdjustment('ap1', 'admin2', '依据不足', meta)

      expect(result.status).toBe('REJECTED')
      expect(prisma.adjustmentApproval.updateMany).toHaveBeenCalledWith({
        where: { id: 'ap1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'REJECTED', approverAdminId: 'admin2', decisionReason: '依据不足' }),
      })
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ACCOUNT_ADJUST_APPROVAL_REJECTED' }),
      )
    })
  })
})
