import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit-log.service'
import { CryptoService } from '../crypto/crypto.service'
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
    private readonly crypto: CryptoService,
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly connectorRegistry: ConnectorRegistry,
  ) {}

  /** 列表脱敏时可明文展示的字段名白名单（标识/地址类，非凭据） */
  private static readonly PLAINTEXT_CONFIG_KEYS = new Set([
    'appId',
    'appid',
    'app_id',
    'mchid',
    'mchId',
    'mch_id',
    'sellerId',
    'gatewayUrl',
    'notifyUrl',
    'sandbox',
  ])

  async listChannels() {
    const channels = await this.prisma.paymentChannelConfig.findMany({
      orderBy: { priority: 'desc' },
    })
    return channels.map((ch) => {
      // H1 安全修复：库内字符串值为密文（enc:v1: 前缀），展示前先解密再脱敏；
      // 脱敏按字段名白名单判定（长度阈值会把短密钥原样漏出）
      const parsed = this.decryptConfigJson(ch.config)
      const safeFields: Record<string, string> = {}
      for (const key of Object.keys(parsed)) {
        const value = parsed[key]
        if (ChannelConfigService.PLAINTEXT_CONFIG_KEYS.has(key)) {
          safeFields[key] = String(value)
        } else if (typeof value === 'string') {
          safeFields[key] = value.length > 8 ? value.slice(0, 8) + '****' : '****'
        } else {
          safeFields[key] = '****'
        }
      }
      return { ...ch, config: JSON.stringify(safeFields) }
    })
  }

  async createChannel(
    dto: { code: string; name: string; type: string; enabled: boolean; priority: number; config?: string },
    ctx: AuditContext,
  ) {
    // H1 安全修复：渠道凭据（apiV3Key/应用私钥等）落库前逐字段 AES-256-GCM 加密
    const encryptedConfig = this.encryptConfigJson(dto.config)
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentChannelConfig.create({
        data: {
          code: dto.code,
          name: dto.name,
          type: dto.type,
          enabled: dto.enabled,
          priority: dto.priority,
          config: encryptedConfig,
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

    let mergedConfig: string
    if (dto.config) {
      // H1 安全修复：旧值先解密（兼容历史明文），合并新值后整体重新加密落库
      let oldParsed: Record<string, unknown>
      try {
        oldParsed = this.decryptConfigJson(existing.config)
        const newParsed = JSON.parse(dto.config) as Record<string, unknown>
        for (const [k, v] of Object.entries(newParsed)) {
          if (v !== undefined && v !== '' && v !== null) {
            oldParsed[k] = v
          }
        }
      } catch {
        oldParsed = this.decryptConfigJson(existing.config)
      }
      mergedConfig = JSON.stringify(this.crypto.encryptConfigValues(oldParsed))
    } else {
      // 未传 config 时也重新加密一次：顺带把历史明文存量迁移为密文
      mergedConfig = JSON.stringify(
        this.crypto.encryptConfigValues(this.decryptConfigJson(existing.config)),
      )
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
          // detail 不落 dto 原文：dto.config 是提交时的明文凭据（apiV3Key/私钥等），
          // 审计日志无加密，原样入链等于把渠道凭据明文持久化给所有 admin:view 可读
          detail: {
            name: dto.name,
            type: dto.type,
            enabled: dto.enabled,
            priority: dto.priority,
            configUpdated: dto.config !== undefined,
          },
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

  /** 渠道配置 JSON：解析后逐字段加密再序列化；非法 JSON 原样返回（交由上层校验） */
  private encryptConfigJson(configJson: string | undefined): string {
    if (!configJson) return '{}'
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(configJson) as Record<string, unknown>
    } catch {
      return configJson
    }
    return JSON.stringify(this.crypto.encryptConfigValues(parsed))
  }

  /** 渠道配置 JSON：解密带密文前缀的字段后返回对象；非法 JSON 返回空对象 */
  private decryptConfigJson(configJson: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(configJson) as Record<string, unknown>
      return this.crypto.decryptConfigValues(parsed)
    } catch {
      return {}
    }
  }

  /** 渠道配置热更新联动：将 DB 配置（解密后）同步到连接器运行时 */
  private async syncConnector(code: string): Promise<void> {
    const connectorName = CHANNEL_CONNECTOR_NAME[code] ?? code
    if (!this.connectorRegistry.get(connectorName)) return
    const row = await this.prisma.paymentChannelConfig.findUnique({ where: { code } })
    if (!row) {
      this.connectorRegistry.syncConfig(connectorName, { priority: 0, credentials: {} })
      return
    }
    const credentials = this.decryptConfigJson(row.config) as Record<string, string>
    this.connectorRegistry.syncConfig(connectorName, { priority: row.priority, credentials })
  }
}
