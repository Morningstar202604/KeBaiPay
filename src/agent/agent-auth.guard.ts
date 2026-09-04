import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { JWT_TOKEN_TYPE_AGENT, AGENT_SCENARIOS } from '../common/constants'
import type { AgentCurrentUser } from './agent-current-user.interface'

type AgentJwtPayload = {
  sub: string
  typ?: string
  scenario?: string
  scopes?: string[]
  // 主体授权信息（由 AgentAuthService.login 签入）
  subjectType?: string
  subjectId?: string
  authId?: string
  authScopes?: string[]
}

/**
 * Agent 认证守卫（第 4 种认证，独立于 User/Admin/OpenAPI）
 *
 * 设计原则：
 * 1. Agent 是独立主体，既不是 user 也不是 admin
 * 2. Agent 持有 JWT_AGENT_SECRET 签发的长期 token（默认 7d）
 * 3. token 中携带主体授权信息（subjectType/subjectId/authId/authScopes）
 * 4. 守卫内实时查 DB 校验 Agent.status 与授权有效性，防止降权残留
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '缺少智能体认证令牌'),
      )
    }
    const token = authHeader.slice(7)

    let payload: AgentJwtPayload
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_AGENT_SECRET'),
      })
    } catch {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '智能体令牌无效或已过期'),
      )
    }

    if (payload.typ !== JWT_TOKEN_TYPE_AGENT) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '智能体令牌无效或已过期'),
      )
    }

    // 校验 scenario 合法
    if (!payload.scenario || !AGENT_SCENARIOS.includes(payload.scenario as 'wallet' | 'merchant' | 'risk' | 'support')) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '智能体场景类型无效'),
      )
    }

    // 实时查 DB 校验 Agent 存在且启用
    const agent = await this.prisma.agent.findUnique({
      where: { id: payload.sub },
    })
    if (!agent) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AGENT_NOT_FOUND),
      )
    }
    if (agent.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AGENT_DISABLED),
      )
    }

    // 若携带了主体授权信息，实时校验授权未撤销/未过期，
    // 并用 DB 中的最新 scopes 覆盖 token 声明（防止缩权后旧 token 权限残留最长 7 天）
    let effectiveAuthScopes = payload.authScopes
    if (payload.authId && payload.subjectId) {
      const auth = await this.prisma.agentAuthorization.findUnique({
        where: { id: payload.authId },
      })
      if (!auth || auth.revokedAt) {
        throw new UnauthorizedException(
          kbError(KBErrorCodes.AGENT_AUTHORIZATION_REVOKED),
        )
      }
      if (auth.expiresAt && auth.expiresAt < new Date()) {
        throw new UnauthorizedException(
          kbError(KBErrorCodes.AGENT_AUTHORIZATION_EXPIRED),
        )
      }
      // 授权记录被管理员缩权后，以 DB 最新 scopes 为准
      if (auth.scopes) {
        try {
          const dbScopes = JSON.parse(auth.scopes as string)
          if (Array.isArray(dbScopes)) effectiveAuthScopes = dbScopes
        } catch {
          /* scopes 存储损坏时保守沿用 token 声明 */
        }
      }

      // 用户主体：实时校验用户状态（冻结/限制收付的用户不得继续通过 Agent 操作）
      if (payload.subjectType === 'user') {
        const subjectUser = await this.prisma.user.findUnique({
          where: { id: payload.subjectId },
          select: { status: true },
        })
        if (!subjectUser || subjectUser.status === 'FROZEN' || subjectUser.status === 'EXPENSE_RESTRICTED') {
          throw new UnauthorizedException(
            kbError(KBErrorCodes.FORBIDDEN, '用户账户状态异常，智能体操作被暂停'),
          )
        }
      }
    } else {
      // 未绑定主体的 token 只能视为匿名能力，禁止进入业务接口
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AGENT_AUTHORIZATION_REVOKED, '智能体令牌缺少主体绑定'),
      )
    }

    const user: AgentCurrentUser = {
      sub: payload.sub,
      typ: 'agent',
      scenario: payload.scenario!,
      // scenario 变更/降级时以 DB 中的 agent.scenario 为准
      scopes: agent.scenario === payload.scenario ? (payload.scopes ?? []) : [],
      subjectType: payload.subjectType,
      subjectId: payload.subjectId,
      authId: payload.authId,
      authScopes: effectiveAuthScopes,
    }
    request.user = user
    return true
  }
}
