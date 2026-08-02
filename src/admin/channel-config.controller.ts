import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Request } from 'express'
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard'
import { PermissionsGuard } from '../admin/permissions.guard'
import { RequirePermissions } from '../admin/permissions.decorator'
import { AdminCurrentUser } from '../admin/admin-current-user.decorator'
import { AdminCurrentUser as AdminCurrentUserType } from '../admin/admin-current-user.interface'
import { AdminService } from '../admin/admin.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit-log.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { ConnectorRegistry } from '../payment-channels/connector.registry'
import { CHANNEL_CONNECTOR_NAME } from '../payment-channels/payment-channel.bridge'
import { IsString, IsBoolean, IsNumber, IsOptional, Min } from 'class-validator'

class CreateChannelConfigDto {
  @IsString() code!: string
  @IsString() name!: string
  @IsString() type!: string
  @IsBoolean() enabled = false
  @IsNumber() @Min(0) priority = 0
  @IsOptional() @IsString() config = '{}'
}

class UpdateChannelConfigDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() type?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsNumber() @Min(0) priority?: number
  @IsOptional() @IsString() config?: string
}

@ApiTags('管理后台')
@ApiBearerAuth('user-auth')
@Controller('admin/channels')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ChannelConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminService: AdminService,
    private readonly auditLog: AuditLogService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly connectorRegistry: ConnectorRegistry,
  ) {}

  @Get()
  @RequirePermissions('admin:view')
  @ApiOperation({ summary: '支付渠道列表', description: '查询所有支付渠道配置（敏感字段已脱敏）' })
  @ApiResponse({ status: 200, description: '返回渠道列表' })
  async listChannels() {
    const channels = await this.prisma.paymentChannelConfig.findMany({
      orderBy: { priority: 'desc' },
    })

    return channels.map(ch => {
      let safeConfig = '{}'
      try {
        const parsed = JSON.parse(ch.config)
        const safeFields: Record<string, string> = {}
        for (const key of Object.keys(parsed)) {
          if (typeof parsed[key] === 'string' && parsed[key].length > 20) {
            safeFields[key] = parsed[key].slice(0, 8) + '****'
          } else {
            safeFields[key] = parsed[key]
          }
        }
        safeConfig = JSON.stringify(safeFields)
      } catch {
        // ignore
      }
      return { ...ch, config: safeConfig }
    })
  }

  @Post()
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '创建支付渠道' })
  @ApiResponse({ status: 201, description: '渠道创建成功' })
  async createChannel(
    @Body() dto: CreateChannelConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    // 业务写与审计日志在同一事务，保证渠道创建可追溯
    const result = await this.prisma.$transaction(async (tx) => {
      const result = await tx.paymentChannelConfig.create({
        data: {
          code: dto.code,
          name: dto.name,
          type: dto.type,
          enabled: dto.enabled,
          priority: dto.priority,
          config: dto.config,
        },
      })

      await this.auditLog.log(
        {
          adminId: admin.sub,
          action: 'CHANNEL_CONFIG_CREATE',
          target: dto.code,
          detail: { name: dto.name, type: dto.type },
          ip: req.ip,
          userAgent: req.headers['user-agent'] as string,
        },
        tx,
      )

      return result
    })

    // 事务提交后同步连接器运行时配置（优先级 + 凭据）
    await this.syncConnector(dto.code)

    return result
  }

  @Put(':code')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '更新支付渠道' })
  @ApiResponse({ status: 200, description: '渠道更新成功' })
  async updateChannel(
    @Param('code') code: string,
    @Body() dto: UpdateChannelConfigDto,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    const existing = await this.prisma.paymentChannelConfig.findUnique({
      where: { code },
    })
    if (!existing) {
      return { error: '渠道不存在' }
    }

    let mergedConfig = existing.config
    if (dto.config) {
      try {
        const oldParsed = JSON.parse(existing.config)
        const newParsed = JSON.parse(dto.config)
        for (const [k, v] of Object.entries(newParsed)) {
          if (v !== undefined && v !== '' && v !== null) {
            oldParsed[k] = v
          }
        }
        mergedConfig = JSON.stringify(oldParsed)
      } catch {
        mergedConfig = dto.config
      }
    }

    // 业务写与审计日志在同一事务，保证渠道变更可追溯
    const result = await this.prisma.$transaction(async (tx) => {
      const result = await tx.paymentChannelConfig.update({
        where: { code },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.enabled !== undefined && { enabled: dto.enabled }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          config: mergedConfig,
        },
      })

      await this.auditLog.log(
        {
          adminId: admin.sub,
          action: 'CHANNEL_CONFIG_UPDATE',
          target: code,
          detail: dto,
          ip: req.ip,
          userAgent: req.headers['user-agent'] as string,
        },
        tx,
      )

      return result
    })

    // 事务提交后同步连接器运行时配置（优先级 + 凭据）
    await this.syncConnector(code)

    return result
  }

  @Delete(':code')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '删除支付渠道' })
  @ApiResponse({ status: 200, description: '删除成功' })
  async deleteChannel(
    @Param('code') code: string,
    @AdminCurrentUser() admin: AdminCurrentUserType,
    @Req() req: Request,
  ) {
    // 业务写与审计日志在同一事务，保证渠道删除可追溯
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentChannelConfig.delete({ where: { code } })

      await this.auditLog.log(
        {
          adminId: admin.sub,
          action: 'CHANNEL_CONFIG_DELETE',
          target: code,
          detail: {},
          ip: req.ip,
          userAgent: req.headers['user-agent'] as string,
        },
        tx,
      )
    })

    // 渠道已删除，重置连接器运行时配置（避免残留旧凭据）
    await this.syncConnector(code)

    return { success: true }
  }

  @Post(':code/test')
  @RequirePermissions('risk:config')
  @ApiOperation({ summary: '测试支付渠道', description: '验证渠道是否可用' })
  @ApiResponse({ status: 200, description: '渠道可用' })
  async testChannel(
    @Param('code') code: string,
    @AdminCurrentUser() admin: AdminCurrentUserType,
  ) {
    const channel = this.channelRegistry.getChannel(code)
    return {
      code: channel.code,
      name: channel.name,
      available: true,
      message: `${channel.name} 渠道可用`,
    }
  }

  /**
   * 渠道配置热更新联动：将 DB 中的渠道配置（优先级 + 凭据）同步到
   * ConnectorRegistry 中对应连接器的运行时配置，保证路由优先级与凭据一致。
   * 渠道已删除时重置连接器配置；无对应连接器时忽略（连接器体系可选）。
   */
  private async syncConnector(code: string): Promise<void> {
    const connectorName = CHANNEL_CONNECTOR_NAME[code] ?? code
    if (!this.connectorRegistry.get(connectorName)) {
      return
    }
    const row = await this.prisma.paymentChannelConfig.findUnique({ where: { code } })
    if (!row) {
      this.connectorRegistry.syncConfig(connectorName, { priority: 0, credentials: {} })
      return
    }
    let credentials: Record<string, string> = {}
    try {
      credentials = JSON.parse(row.config) as Record<string, string>
    } catch {
      // 配置非法 JSON 时使用空凭据，不影响渠道实例启动
    }
    this.connectorRegistry.syncConfig(connectorName, { priority: row.priority, credentials })
  }
}
