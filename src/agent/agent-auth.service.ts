import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { kbError, KBErrorCodes } from '../common/error-codes'
import {
  JWT_TOKEN_TYPE_AGENT,
  AGENT_SCENARIOS,
  type AgentScenario,
} from '../common/constants'
import { generateOrderNo, generateAppSecret, safeJsonParse } from '../common/helpers'
import type { AgentCurrentUser } from './agent-current-user.interface'

/**
 * Agent 认证服务：
 *  - createAgent：创建 Agent（管理端调用，分配 appSecret）
 *  - activate：用户/商户激活 Agent（创建 AgentAuthorization）
 *  - login：换取长期 JWT token（携带主体授权信息）
 *  - revoke：撤销授权
 */
@Injectable()
export class AgentAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** 创建 Agent（管理端调用） */
  async createAgent(input: {
    name: string
    description?: string
    scenario: string
    scopes?: string[]
  }) {
    if (!AGENT_SCENARIOS.includes(input.scenario as AgentScenario)) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_SCOPE_DENIED, '场景类型无效'))
    }
    // M5 修复：appSecret 只存 sha256 哈希（与 MerchantApp 同一标准）。
    // 明文仅在创建响应中回显一次，此后不可查询——DB 读取者无法伪造 Agent 凭据
    const appSecret = generateAppSecret()
    const appSecretHash = createHash('sha256').update(appSecret).digest('hex')
    const agent = await this.prisma.agent.create({
      data: {
        agentNo: generateOrderNo('AGT'),
        name: input.name,
        description: input.description,
        appSecret: appSecretHash,
        status: 'ACTIVE',
        scopes: JSON.stringify(input.scopes ?? []),
        scenario: input.scenario,
        version: '1.0.0',
      },
    })
    return { ...agent, appSecret }
  }

  /** P0-8：轮换 Agent 密钥（管理端调用）。新明文仅本次响应返回一次，库中只存哈希 */
  async rotateAppSecret(agentId: string) {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) throw new NotFoundException(kbError(KBErrorCodes.AGENT_NOT_FOUND))

    const appSecret = generateAppSecret()
    const appSecretHash = createHash('sha256').update(appSecret).digest('hex')
    const updated = await this.prisma.agent.update({
      where: { id: agentId },
      data: { appSecret: appSecretHash },
    })
    return { ...updated, appSecret }
  }

  /** 用户/商户授权某个 Agent 代为操作 */
  async authorize(input: {
    agentId: string
    subjectType: 'user' | 'merchant'
    subjectId: string
    scopes: string[]
    maxAmount?: number
    expiresAt?: Date
  }) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: input.agentId },
    })
    if (!agent) throw new NotFoundException(kbError(KBErrorCodes.AGENT_NOT_FOUND))
    if (agent.status !== 'ACTIVE') {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_DISABLED))
    }

    // 校验申请的 scopes 必须是 Agent 自身 scopes 的子集
    const agentScopes: string[] = safeJsonParse<string[]>(agent.scopes, [])
    const invalidScopes = input.scopes.filter((s) => !agentScopes.includes(s))
    if (invalidScopes.length > 0) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AGENT_SCOPE_DENIED, `超出 Agent 授权范围: ${invalidScopes.join(',')}`),
      )
    }

    return this.prisma.agentAuthorization.create({
      data: {
        agentId: input.agentId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        scopes: JSON.stringify(input.scopes),
        maxAmount: input.maxAmount ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    })
  }

  /** 用户携带授权记录换取 Agent token（长期） */
  async login(input: {
    agentId: string
    authId: string
    subjectId: string
  }): Promise<{ token: string; expiresIn: string }> {
    const [agent, auth] = await Promise.all([
      this.prisma.agent.findUnique({ where: { id: input.agentId } }),
      this.prisma.agentAuthorization.findUnique({ where: { id: input.authId } }),
    ])
    if (!agent) throw new NotFoundException(kbError(KBErrorCodes.AGENT_NOT_FOUND))
    if (agent.status !== 'ACTIVE') {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_DISABLED))
    }
    if (!auth) throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_NOT_FOUND))
    if (auth.subjectId !== input.subjectId || auth.agentId !== input.agentId) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_NOT_FOUND))
    }
    if (auth.revokedAt) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_REVOKED))
    }
    if (auth.expiresAt && auth.expiresAt < new Date()) {
      throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_EXPIRED))
    }

    const expiresIn = this.configService.get<string>('JWT_AGENT_EXPIRES_IN', '7d')
    const token = this.jwtService.sign(
      {
        sub: agent.id,
        typ: JWT_TOKEN_TYPE_AGENT,
        scenario: agent.scenario,
        scopes: safeJsonParse<string[]>(agent.scopes, []),
        subjectType: auth.subjectType,
        subjectId: auth.subjectId,
        authId: auth.id,
        authScopes: safeJsonParse<string[]>(auth.scopes, []),
      },
      {
        secret: this.configService.get<string>('JWT_AGENT_SECRET'),
        expiresIn: expiresIn as any,
      },
    )
    return { token, expiresIn }
  }

  /** 列出所有 Agent（管理端） */
  async listAgents() {
    return this.prisma.agent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, agentNo: true, name: true, description: true,
        status: true, scenario: true, version: true, createdAt: true,
        // 管理端编辑作用域必须能读到当前值（否则前端保存时会把 scopes 清空）
        scopes: true,
      },
    })
  }

  /** 更新 Agent（管理端：名称/描述/状态/作用域） */
  async updateAgent(
    id: string,
    input: { name?: string; description?: string; status?: string; scopes?: string[] },
  ) {
    const existing = await this.prisma.agent.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(kbError(KBErrorCodes.AGENT_NOT_FOUND))
    if (input.scopes !== undefined) {
      const invalid = input.scopes.filter((s) => typeof s !== 'string' || !/^[a-z]+:[a-z:]+$/.test(s))
      if (invalid.length > 0) {
        throw new UnauthorizedException(kbError(KBErrorCodes.AGENT_SCOPE_DENIED, `非法作用域: ${invalid.join(',')}`))
      }
    }
    return this.prisma.agent.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.scopes !== undefined && { scopes: JSON.stringify(input.scopes) }),
      },
      // 回显白名单：防止把 appSecret 等敏感字段原样带回响应
      select: { id: true, name: true, description: true, scenario: true, status: true, scopes: true },
    })
  }

  /** 列出当前用户可用的 Agent 及授权状态（用户端） */
  async listMyAgents(userId: string) {
    const [agents, auths] = await Promise.all([
      this.prisma.agent.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, agentNo: true, name: true, description: true,
          scenario: true, version: true, scopes: true,
        },
      }),
      this.prisma.agentAuthorization.findMany({
        where: { subjectId: userId, subjectType: 'user' },
        select: { id: true, agentId: true, scopes: true, revokedAt: true, expiresAt: true },
      }),
    ])
    return agents.map((a) => {
      const auth = auths.find((x) => x.agentId === a.id && !x.revokedAt)
      return {
        ...a,
        scopes: safeJsonParse<string[]>(a.scopes, []),
        authorization: auth ? { id: auth.id, scopes: safeJsonParse<string[]>(auth.scopes, []) } : null,
      }
    })
  }

  /** 撤销授权（属主校验：仅授权主体本人可撤销，防止水平越权吊销他人授权） */
  async revoke(authId: string, subjectId?: string) {
    const auth = await this.prisma.agentAuthorization.findUnique({
      where: { id: authId },
    })
    if (!auth) throw new NotFoundException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_NOT_FOUND))
    if (subjectId != null) {
      const isOwner =
        auth.subjectType === 'user' ? auth.subjectId === subjectId : false
      if (!isOwner) {
        throw new NotFoundException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_NOT_FOUND))
      }
    }
    if (auth.revokedAt) return auth
    return this.prisma.agentAuthorization.update({
      where: { id: authId },
      data: { revokedAt: new Date() },
    })
  }

  /** 列出某个用户的授权 */
  async listMyAuthorizations(userId: string) {
    return this.prisma.agentAuthorization.findMany({
      where: { subjectId: userId, subjectType: 'user' },
      include: { agent: true },
      orderBy: { createdAt: 'desc' },
    })
  }
}
