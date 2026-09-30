import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { QrCodesService } from './qr-codes.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { UsersService } from '../users/users.service.js'
import { RiskEngineService } from '../risk/risk-engine.service.js'
import { RedisService } from '../redis/redis.service.js'

type PrismaMock = {
  qrCode: Record<string, jest.Mock>
} & Record<string, unknown>

type CreateArgs = { data: Record<string, unknown> }

describe('QrCodesService', () => {
  let service: QrCodesService
  let prisma: PrismaMock

  beforeEach(async () => {
    prisma = {
      qrCode: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    }

    const usersService = {}
    const riskEngine = {}
    const redis = {}

    const module = await Test.createTestingModule({
      providers: [
        QrCodesService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsersService, useValue: usersService },
        { provide: RiskEngineService, useValue: riskEngine },
        { provide: RedisService, useValue: redis },
      ],
    }).compile()

    service = module.get(QrCodesService)
  })

  describe('getPersonalCode 个人码懒创建', () => {
    it('不存在时创建个人码', async () => {
      prisma.qrCode.findFirst.mockResolvedValue(null)
      prisma.qrCode.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 'q1', code: 'KB-1', ...query.data })
      })

      const code = await service.getPersonalCode('u1')
      expect(code.type).toBe('PERSONAL')
      expect(code.status).toBe('ACTIVE')
      expect(code.userId).toBe('u1')
      expect(prisma.qrCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            type: 'PERSONAL',
            status: 'ACTIVE',
          }),
        }),
      )
    })

    it('已存在时直接返回不重复创建', async () => {
      const existing = {
        id: 'q1',
        code: 'KB-1',
        userId: 'u1',
        type: 'PERSONAL',
        status: 'ACTIVE',
      }
      prisma.qrCode.findFirst.mockResolvedValue(existing)

      const code = await service.getPersonalCode('u1')
      expect(code).toBe(existing)
      expect(prisma.qrCode.create).not.toHaveBeenCalled()
    })
  })

  describe('createFixedCode 固定金额码', () => {
    it('金额小于等于 0 报错', async () => {
      await expect(
        service.createFixedCode('u1', { amount: 0 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('创建固定金额码（元转分）', async () => {
      prisma.qrCode.create.mockImplementation((args: unknown) => {
        const query = args as CreateArgs
        return Promise.resolve({ id: 'q1', ...query.data })
      })
      const code = await service.createFixedCode('u1', {
        amount: 5.5,
        remark: '咖啡',
      })
      expect(code.type).toBe('FIXED_AMOUNT')
      expect(code.amount).toBe(550) // 5.5 元 = 550 分
      expect(code.remark).toBe('咖啡')
      expect(code.status).toBe('ACTIVE')
    })
  })
})
