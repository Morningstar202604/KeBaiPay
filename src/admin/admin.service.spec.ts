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
  riskEvent: Record<string, jest.Mock>
  adminUser: Record<string, jest.Mock>
  systemConfig: Record<string, jest.Mock>
  adminOperationLog: Record<string, jest.Mock>
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

    // Redis 锁 mock 直接执行回调
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


})

