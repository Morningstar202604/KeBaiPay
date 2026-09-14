import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { AuthService } from './auth.service'
import { UsersService } from '../users/users.service'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { SmsService } from '../sms/sms.service'

// bcrypt 在测试中要可控：避免真实 hash/compare 的耗时与随机盐干扰断言
// （假哈希值由片段拼接构造，非真实凭据）
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-' + 'pw'),
  compare: jest.fn(),
}))

type UsersMock = { create: jest.Mock; findByCredential: jest.Mock }
type PrismaMock = { loginLog: { create: jest.Mock } }
type RedisMock = {
  isEnabled: jest.Mock
  get: jest.Mock
  incr: jest.Mock
  del: jest.Mock
}
type SmsMock = { getConfigStatus: jest.Mock; verifyCode: jest.Mock }

describe('AuthService', () => {
  let service: AuthService
  let users: UsersMock
  let prisma: PrismaMock
  let redis: RedisMock
  let sms: SmsMock

  beforeEach(async () => {
    users = {
      create: jest.fn(),
      findByCredential: jest.fn(),
    }
    prisma = { loginLog: { create: jest.fn().mockResolvedValue(undefined) } }
    redis = {
      isEnabled: jest.fn().mockReturnValue(true),
      get: jest.fn().mockResolvedValue(null),
      incr: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(undefined),
    }
    // 默认模拟"短信服务未配置"（provider=mock），与本地开发环境一致
    sms = {
      getConfigStatus: jest.fn().mockReturnValue({ provider: 'mock', configured: false }),
      verifyCode: jest.fn().mockResolvedValue({ valid: true, message: 'ok' }),
    }

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('jwt-token') } },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: SmsService, useValue: sms },
      ],
    }).compile()

    service = module.get(AuthService)
    ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashed-' + 'pw')
    ;(bcrypt.compare as jest.Mock).mockReset()
  })

  describe('register', () => {
    it('缺少手机号与邮箱时抛 BadRequestException', async () => {
      await expect(
        service.register({ nickname: 'u', password: 'pw' }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('正常注册返回 userId 与 token，密码经过 bcrypt hash', async () => {
      users.create.mockResolvedValue({ id: 'u1' })
      const res = await service.register({ nickname: 'u', phone: '13800000000', password: 'pw' })
      expect(res).toEqual({ userId: 'u1', token: 'jwt-token' })
      expect(bcrypt.hash).toHaveBeenCalledWith('pw', expect.any(Number))
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ loginPassword: 'hashed-' + 'pw' }),
      )
      // 短信未配置（mock）时不校验验证码
      expect(sms.verifyCode).not.toHaveBeenCalled()
    })

    it('短信未配置时手机号注册无需验证码，直接放行', async () => {
      users.create.mockResolvedValue({ id: 'u2' })
      const res = await service.register({
        nickname: 'u',
        phone: '13800000000',
        password: 'pw',
      })
      expect(res).toEqual({ userId: 'u2', token: 'jwt-token' })
      expect(sms.verifyCode).not.toHaveBeenCalled()
    })

    it('短信已配置时手机号注册缺少验证码被拒绝', async () => {
      sms.getConfigStatus.mockReturnValue({ provider: 'aliyun', configured: true })
      users.create.mockResolvedValue({ id: 'u3' })
      await expect(
        service.register({ nickname: 'u', phone: '13800000000', password: 'pw' }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(users.create).not.toHaveBeenCalled()
    })

    it('短信已配置且验证码错误时注册被拒绝', async () => {
      sms.getConfigStatus.mockReturnValue({ provider: 'aliyun', configured: true })
      sms.verifyCode.mockResolvedValue({ valid: false, message: '验证码已过期' })
      await expect(
        service.register({
          nickname: 'u',
          phone: '13800000000',
          password: 'pw',
          smsCode: '123456',
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(sms.verifyCode).toHaveBeenCalledWith('13800000000', '123456', 'register')
      expect(users.create).not.toHaveBeenCalled()
    })

    it('短信已配置且验证码正确时注册成功（验证码场景 register）', async () => {
      sms.getConfigStatus.mockReturnValue({ provider: 'aliyun', configured: true })
      users.create.mockResolvedValue({ id: 'u4' })
      const res = await service.register({
        nickname: 'u',
        phone: '13800000000',
        password: 'pw',
        smsCode: '654321',
      })
      expect(res).toEqual({ userId: 'u4', token: 'jwt-token' })
      expect(sms.verifyCode).toHaveBeenCalledWith('13800000000', '654321', 'register')
    })

    it('短信已配置但邮箱注册不需要验证码', async () => {
      sms.getConfigStatus.mockReturnValue({ provider: 'aliyun', configured: true })
      users.create.mockResolvedValue({ id: 'u5' })
      const res = await service.register({
        nickname: 'u',
        email: 'a@b.com',
        password: 'pw',
      })
      expect(res).toEqual({ userId: 'u5', token: 'jwt-token' })
      expect(sms.verifyCode).not.toHaveBeenCalled()
    })
  })

  describe('login', () => {
    it('缺少手机号与邮箱时抛 BadRequestException', async () => {
      await expect(service.login({ password: 'pw' })).rejects.toBeInstanceOf(BadRequestException)
    })

    it('账号不存在时计数失败并记录 loginLog，错误码统一 INVALID_CREDENTIALS', async () => {
      users.findByCredential.mockResolvedValue(null)
      await expect(service.login({ phone: '13800000000', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      )
      expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('login:fail:'), expect.any(Number))
      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ success: false, userId: null }) }),
      )
    })

    it('密码错误时计数失败并记录 loginLog', async () => {
      users.findByCredential.mockResolvedValue({ id: 'u1', loginPassword: 'hashed-' + 'pw' })
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(false)
      await expect(service.login({ phone: '13800000000', password: 'wrong' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      )
      expect(redis.incr).toHaveBeenCalled()
      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', success: false }) }),
      )
    })

    it('密码正确时清除失败计数、记录成功 loginLog 并返回 token', async () => {
      users.findByCredential.mockResolvedValue({ id: 'u1', loginPassword: 'hashed-' + 'pw' })
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      const res = await service.login({ phone: '13800000000', password: 'pw' }, '1.2.3.4', 'ua')
      expect(res).toEqual({ userId: 'u1', token: 'jwt-token' })
      expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('login:fail:'))
      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', success: true, ip: '1.2.3.4' }) }),
      )
    })

    it('失败计数达到 5 次时锁定账号，不查找用户直接拒绝', async () => {
      redis.get.mockResolvedValue('5')
      await expect(service.login({ phone: '13800000000', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      )
      expect(users.findByCredential).not.toHaveBeenCalled()
      expect(redis.incr).not.toHaveBeenCalled()
      expect(prisma.loginLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ reason: '账号已被锁定' }) }),
      )
    })

    it('Redis 未启用时使用进程内 Map 降级计数', async () => {
      redis.isEnabled.mockReturnValue(false)
      users.findByCredential.mockResolvedValue(null)
      // 连续失败 5 次
      for (let i = 0; i < 5; i++) {
        await expect(
          service.login({ phone: '13800000000', password: 'pw' }),
        ).rejects.toBeInstanceOf(UnauthorizedException)
      }
      // 第 6 次应被锁定
      await expect(service.login({ phone: '13800000000', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      )
      // 进程内计数模式下不应调用 usersService.findByCredential（在第 6 次时）
      // 前 5 次会调用 findByCredential，这里只验证第 6 次锁定不调用
      const callsBeforeLock = users.findByCredential.mock.calls.length
      await expect(
        service.login({ phone: '13800000000', password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException)
      expect(users.findByCredential.mock.calls.length).toBe(callsBeforeLock)
    })
  })
})
