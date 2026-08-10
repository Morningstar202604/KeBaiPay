import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit-log.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { ConnectorRegistry } from '../payment-channels/connector.registry'
import { CHANNEL_CONNECTOR_NAME } from '../payment-channels/payment-channel.bridge'
import { AdminCurrentUser as AdminCurrentUserType } from './admin-current-user.interface'

export interface AuditContext {
  admin: AdminCurrentUserType
  ip?: string
  userAgent?: string
}

/** 渠道配置（业务写入 + 审计 + 连接器热同步）下沉到 Service，控制器不直接持有 PrismaService */
@Injectable()
export class ChannelConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly connectorRegistry: ConnectorRegistry,
  ) {}

  async listChannels() {
    const channels = await this.prisma.paymentChannelConfig.findMany({
      orderBy: { priority: 'desc' },
    })
    return channels.map((ch) => {
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

  async createChannel(
    dto: { code: string; name: string; type: string; enabled: boolean; priority: number; config?: string },
    ctx: AuditContext,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentChannelConfig.create({
        data: {
          code: dto.code,
          name: dto.name,
          type: dto.type,
          enabled: dto.enabled,
          priority: dto.priority,
          config: dto.config || '{}',
        },
      })
      await this.auditLog.log(
        {
          adminId: ctx.admin.sub,
          action: 'CHANNEL_CONFIG_CREATE',
          target: dto.code,
          detail: { name: dto.name, type: dto.type },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      )
      return created
    })

    await this.syncConnector(dto.code)
    return result
  }

  async updateChannel(
    code: string,
    dto: { name?: string; type?: string; enabled?: boolean; priority?: number; config?: string },
    ctx: AuditContext,
  ) {
    const existing = await this.prisma.paymentChannelConfig.findUnique({ where: { code } })
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

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentChannelConfig.update({
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
          adminId: ctx.admin.sub,
          action: 'CHANNEL_CONFIG_UPDATE',
          target: code,
          detail: dto,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      )
      return updated
    })

    await this.syncConnector(code)
    return result
  }

  async deleteChannel(code: string, ctx: AuditContext) {
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentChannelConfig.delete({ where: { code } })
      await this.auditLog.log(
        {
          adminId: ctx.admin.sub,
          action: 'CHANNEL_CONFIG_DELETE',
          target: code,
          detail: {},
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      )
    })

    await this.syncConnector(code)
    return { success: true }
  }

  testChannel(code: string) {
    const channel = this.channelRegistry.getChannel(code)
    return {
      code: channel.code,
      name: channel.name,
      available: true,
      message: `${channel.name} 渠道可用`,
    }
  }

  /** 渠道配置热更新联动：将 DB 配置同步到连接器运行时 */
  private async syncConnector(code: string): Promise<void> {
    const connectorName = CHANNEL_CONNECTOR_NAME[code] ?? code
    if (!this.connectorRegistry.get(connectorName)) return
    const row = await this.prisma.paymentChannelConfig.findUnique({ where: { code } })
    if (!row) {
      this.connectorRegistry.syncConfig(connectorName, { priority: 0, credentials: {} })
      return
    }
    let credentials: Record<string, string> = {}
    try {
      credentials = JSON.parse(row.config) as Record<string, string>
    } catch {
      // ignore
    }
    this.connectorRegistry.syncConfig(connectorName, { priority: row.priority, credentials })
  }
}
