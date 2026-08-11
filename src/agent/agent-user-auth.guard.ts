import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { JWT_TOKEN_TYPE_USER } from '../common/constants'

type UserJwtPayload = { sub: string; typ?: string }

/**
 * Agent 用户自助认证守卫：校验「用户」JWT（JWT_USER_SECRET）。
 *
 * 用途：agent 模块中由用户自己操作的端点（login / authorize / revoke / authorizations）。
 * 用户用自己的账号登录换取 Agent 长期 token，并管理自己对 Agent 的授权。
 * 自包含实现，不依赖 Passport/AuthModule，避免模块耦合。
 */
@Injectable()
export class AgentUserAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '缺少用户认证令牌'),
      )
    }
    const token = authHeader.slice(7)

    let payload: UserJwtPayload
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_USER_SECRET'),
      })
    } catch {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '用户令牌无效或已过期'),
      )
    }
    if (payload.typ !== JWT_TOKEN_TYPE_USER || !payload.sub) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '用户令牌无效或已过期'),
      )
    }
    request.user = { userId: payload.sub, sub: payload.sub }
    return true
  }
}
