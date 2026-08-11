import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { JWT_TOKEN_TYPE_ADMIN } from '../common/constants'

type AdminJwtPayload = { sub: string; role: string; typ?: string }

/**
 * Agent 管理认证守卫：校验「管理员」JWT（JWT_ADMIN_SECRET）。
 *
 * 用途：agent 模块中由管理员操作的端点（创建/管理 Agent）。
 * 自包含实现，不依赖 Passport/AdminModule。
 */
@Injectable()
export class AgentAdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '缺少管理员认证令牌'),
      )
    }
    const token = authHeader.slice(7)

    let payload: AdminJwtPayload
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ADMIN_SECRET'),
      })
    } catch {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员令牌无效或已过期'),
      )
    }
    if (payload.typ !== JWT_TOKEN_TYPE_ADMIN || !payload.sub) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员令牌无效或已过期'),
      )
    }
    request.admin = { sub: payload.sub, role: payload.role }
    return true
  }
}
