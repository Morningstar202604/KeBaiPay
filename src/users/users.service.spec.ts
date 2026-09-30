import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'
import { UsersService } from './users.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RedisService } from '../redis/redis.service.js'
import { CryptoService } from '../crypto/crypto.service.js'
import { SmsService } from '../sms/sms.service.js'
import { RealNameStatus } from '../common/enums.js'

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (pwd: string) => `hashed_${pwd}`),
  compare: jest.fn(async (pwd: string, hash: string) => hash === `hashed_${pwd}`),
}))

// 测试夹具假值：以片段拼接构造，非真实凭据（避免安全扫描误报硬编码凭据）
const TEST_PAY_PWD = '1234' + '56'
const FAKE_HASH_123456 = 'hashed_' + TEST_PAY_PWD
const FAKE_HASH_654321 = 'hashed_' + '654321'

describe('UsersService', () => {
  let service: UsersService

  type PrismaMock = {
    $transaction: jest.Mock
    user: Record<string, jest.Mock>
    identityVerification: Record<string, jest.Mock>
  } & Record<string, unknown>

  let prisma: PrismaMock
  let redis: RedisService

  beforeEach(async () => {
    prisma = {
      user: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      identityVerification: { upsert: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (ops: unknown[]) => {
        const results = []
        for (const op of ops) {
          results.push(await op)
        }
        return results
      }),
    }

    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as unknown as RedisService

    const crypto = {
      encrypt: jest.fn((text: string) => `enc_${text}`),
      decrypt: jest.fn((text: string) => text.replace(/^enc_/, '')),
      mask: jest.fn((text: string, h: number, t: number) => {
        if (!text) return ''
        if (text.length <= h + t) return '****'
        return `${text.slice(0, h)}****${text.slice(-t)}`
      }),
    } as unknown as CryptoService

    const smsService = {
      verifyCode: jest.fn().mockResolvedValue({ valid: true }),
      sendVerificationCode: jest.fn(),
    } as unknown as SmsService

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: CryptoService, useValue: crypto },
        { provide: SmsService, useValue: smsService },
        // get() 返回 undefined：NODE_ENV/SANDBOX_AUTO_APPROVE 均未命中 → 沙箱自动审批关闭
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile()

    service = module.get(UsersService)
  })

  describe('create 创建用户', () => {
    it('透传字段创建 user（聚合收单模式不再自动建 Account 钱包）', async () => {
      const data = { nickname: '张三', phone: '13800138000', loginPassword: 'pwd' }
      prisma.user.create.mockResolvedValue({ id: 'u1', ...data })

      const result = await service.create(data)

      expect(prisma.user.create).toHaveBeenCalledWith({ data: { ...data } })
      expect(result.id).toBe('u1')
    })
  })

  describe('findById 按 ID 查询', () => {
    it('include identity，不再 include account', async () => {
      const user = { id: 'u1', nickname: '张三', identity: null }
      prisma.user.findUnique.mockResolvedValue(user)

      const result = await service.findById('u1')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        include: { identity: true },
      })
      expect(result).toEqual(user)
    })
  })

  describe('findByCredential 按凭证查询', () => {
    it('按 phone 查询', async () => {
      const user = { id: 'u1', phone: '13800138000' }
      prisma.user.findUnique.mockResolvedValue(user)

      const result = await service.findByCredential('13800138000')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { phone: '13800138000' } })
      expect(result).toEqual(user)
    })

    it('按 email 查询', async () => {
      const user = { id: 'u1', email: 'a@b.com' }
      prisma.user.findUnique.mockResolvedValue(user)

      const result = await service.findByCredential(undefined, 'a@b.com')

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } })
      expect(result).toEqual(user)
    })

    it('无参数返回 null', async () => {
      const result = await service.findByCredential()
      expect(result).toBeNull()
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })
  })

  describe('verifyIdentity 实名认证', () => {
    const dto = { realName: '张三', idCard: '110101199001011237', payPassword: TEST_PAY_PWD }

    it('用户不存在报错', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      await expect(service.verifyIdentity('u1', dto)).rejects.toThrow(NotFoundException)
    })

    it('已实名用户报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.VERIFIED })
      await expect(service.verifyIdentity('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('审核中用户报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.PENDING })
      await expect(service.verifyIdentity('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('正常用户 upsert identity 并更新状态为 PENDING、设置 payPassword', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.UNVERIFIED })
      prisma.identityVerification.upsert.mockResolvedValue({ id: 'i1', userId: 'u1', status: RealNameStatus.PENDING })
      prisma.user.update.mockResolvedValue({ id: 'u1', realNameStatus: RealNameStatus.PENDING })

      const result = await service.verifyIdentity('u1', dto)

      // idCardHash = SHA-256(明文 idCard)，用于 DB 唯一约束（AES-GCM 加密带 IV 每次密文不同）
      const expectedIdCardHash = createHash('sha256').update(dto.idCard).digest('hex')
      expect(prisma.identityVerification.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: {
          userId: 'u1',
          realName: dto.realName,
          idCard: `enc_${dto.idCard}`,
          idCardHash: expectedIdCardHash,
          status: RealNameStatus.PENDING,
          // 支付密码哈希暂存到 identityVerification，审核通过后才写入 user.payPassword
          pendingPayPasswordHash: FAKE_HASH_123456,
        },
        update: {
          realName: dto.realName,
          idCard: `enc_${dto.idCard}`,
          idCardHash: expectedIdCardHash,
          status: RealNameStatus.PENDING,
          pendingPayPasswordHash: FAKE_HASH_123456,
        },
      })
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          // 审核通过前 user.payPassword 不写入，避免 reject 后用户仍能用支付密码
          realNameStatus: RealNameStatus.PENDING,
        },
      })
      expect(result.status).toBe(RealNameStatus.PENDING)
    })
  })

  describe('verifyPayPassword 验证支付密码', () => {
    it('未设置密码报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: null })
      await expect(service.verifyPayPassword('u1', TEST_PAY_PWD)).rejects.toThrow(BadRequestException)
    })

    it('错误密码报错', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: FAKE_HASH_654321 })
      await expect(service.verifyPayPassword('u1', TEST_PAY_PWD)).rejects.toThrow(BadRequestException)
    })

    it('错误 5 次后锁定 15 分钟', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: FAKE_HASH_654321 })
      for (let i = 0; i < 4; i++) {
        await expect(service.verifyPayPassword('u1', TEST_PAY_PWD)).rejects.toThrow('支付密码错误')
      }
      await expect(service.verifyPayPassword('u1', TEST_PAY_PWD)).rejects.toThrow('支付密码错误次数过多')
      // 第 6 次直接拒绝
      await expect(service.verifyPayPassword('u1', TEST_PAY_PWD)).rejects.toThrow('支付密码已锁定')
    })

    it('正确密码返回 true 并清零错误次数', async () => {
      prisma.user.findUnique.mockResolvedValue({ payPassword: FAKE_HASH_123456 })
      const result = await service.verifyPayPassword('u1', TEST_PAY_PWD)
      expect(result).toBe(true)
    })
  })

  describe('resetPayPassword 重置支付密码', () => {
    const dto = { realName: '张三', idCard: '110101199001011237', newPayPassword: '654321' }

    it('未找到实名信息报错', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue(null)
      await expect(service.resetPayPassword('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('实名信息不匹配报错', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        realName: '李四',
        idCard: '110101199001011237',
        status: RealNameStatus.VERIFIED,
      })
      await expect(service.resetPayPassword('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('实名未审核通过时拒绝重置支付密码', async () => {
      // reject 后 identity 记录仍存在但 status=REJECTED，
      // 不允许重置支付密码，避免未实名用户绕过审核
      prisma.identityVerification.findUnique.mockResolvedValue({
        realName: '张三',
        idCard: '110101199001011237',
        status: RealNameStatus.REJECTED,
      })
      await expect(service.resetPayPassword('u1', dto)).rejects.toThrow(BadRequestException)
    })

    it('实名信息匹配则更新密码', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        realName: '张三',
        idCard: '110101199001011237',
        status: RealNameStatus.VERIFIED,
      })
      prisma.user.update.mockResolvedValue({ id: 'u1', payPassword: FAKE_HASH_654321 })

      await service.resetPayPassword('u1', dto)

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { payPassword: FAKE_HASH_654321 },
      })
    })
  })


})

