import { AgentAuthService } from './agent-auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'

describe('AgentAuthService.createAgent 密钥哈希存储（M5 修复）', () => {
  let service: AgentAuthService
  const prisma = {
    agent: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    agentAuthorization: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  }
  const jwtService = { sign: jest.fn(() => 'jwt-token') }
  const configService = { get: jest.fn(() => 'unit-test-agent-jwt-secret-32chars') }

  beforeEach(() => {
    jest.clearAllMocks()
    service = new AgentAuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    )
  })

  it('库中只存 sha256 哈希，明文仅在创建响应回显一次', async () => {
    prisma.agent.create.mockImplementation(({ data }: { data: Record<string, string> }) =>
      Promise.resolve({ id: 'a1', ...data }),
    )

    const result = await service.createAgent({
      name: '测试智能体',
      scenario: 'wallet',
      scopes: ['balance:read'],
    })

    // 库内为 64 位 hex 摘要，且不等于明文
    const storedArg = prisma.agent.create.mock.calls[0][0].data
    expect(storedArg.appSecret).toMatch(/^[0-9a-f]{64}$/)
    // 响应中的明文与库内哈希一一对应
    expect(result.appSecret).not.toBe(storedArg.appSecret)
    expect(createHash('sha256').update(result.appSecret).digest('hex')).toBe(storedArg.appSecret)
  })
})
