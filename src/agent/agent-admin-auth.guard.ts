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
import { JWT_TOKEN_TYPE_ADMIN } from '../common/constants'
import { AdminRole, AdminStatus } from '../common/enums'

type AdminJwtPayload = { sub: string; role: string; typ?: string }

/**
 * Agent 管理认证守卫：校验「管理员」JWT（JWT_ADMIN_SECRET）。
 *
 * 用途：agent 模块中由管理员操作的端点（创建/管理 Agent）。
 * 自包含实现，不依赖 Passport/AdminModule。
 *
 * 安全：与主站 AdminJwtAuthGuard 同等强度 —— 实时查 DB 校验管理员存在、
 * ACTIVE 且角色合法，防止被禁用/删除的管理员在 token 有效期内继续操作。
 */
@Injectable()
export class AgentAdminAuthGuard implements CanActivate {
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

    // 实时查 DB：管理员必须存在、ACTIVE 且角色合法
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true },
    })
    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员不存在或已被禁用'),
      )
    }
    if (!Object.values(AdminRole).includes(admin.role as AdminRole)) {
      throw new UnauthorizedException(
        kbError(KBErrorCodes.AUTHENTICATION_FAILED, '管理员角色无效'),
      )
    }

    request.admin = { sub: admin.id, role: admin.role }
    return true
  }
}
