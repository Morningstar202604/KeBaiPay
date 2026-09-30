import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../crypto/crypto.service'
import { PaymentChannel, ChannelConfig } from './payment-channel.interface'
import { MockChannel } from './channels/mock.channel'
import { WechatPayChannel } from './channels/wechat-pay.channel'
import { AlipayChannel } from './channels/alipay.channel'

/**
 * 支付渠道注册中心
 *
 * 负责渠道实例的注册、查找与配置加载。
 * 渠道配置存储在 PaymentChannelConfig 表中，config 字段为 JSON 字符串，
 * 其中字符串凭据以 AES-256-GCM 密文落库（enc:v1: 前缀），本类读取时统一解密。
 *
 * 安全说明：生产环境不会降级到 mock 渠道，必须显式配置真实渠道。
 */
@Injectable()
export class PaymentChannelRegistry {
  private readonly logger = new Logger(PaymentChannelRegistry.name)
  private readonly channels = new Map<string, PaymentChannel>()
  private readonly isProduction: boolean

  // 渠道配置进程内 TTL 缓存（仿 risk-engine ruleCache 风格，60s）
  // 资金热路径每笔交易会读渠道配置（DB findUnique/findMany + AES 解密），
  // 缓存命中后省 1 次 DB 查 + 1 次 AES 解密。
  // 注意：getEnabledConfig 只缓存成功结果；NotFoundException（未启用渠道）
  // 不落缓存，避免「未启用」被缓存 60s 误导后续请求。
  // 注意：多副本部署时各进程独立缓存，管理员改配置后各副本最多 60s 才失效。
  private readonly enabledConfigCache = new Map<
    string,
    { value: { code: string; name: string; config: ChannelConfig }; expiry: number }
  >()
  private readonly CONFIG_CACHE_TTL_MS = 60_000

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly crypto: CryptoService,
    mockChannel: MockChannel,
    wechatPayChannel: WechatPayChannel,
    alipayChannel: AlipayChannel,
  ) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV', 'development') === 'production'
    this.register(mockChannel)
    this.register(wechatPayChannel)
    this.register(alipayChannel)
  }

  register(channel: PaymentChannel) {
    this.channels.set(channel.code, channel)
    this.logger.log(`注册支付渠道: ${channel.code} (${channel.name})`)
  }

  /** 列出全部已注册渠道 code（供健康检查/配置管理查询真实渠道集合） */
  getAllChannelCodes(): string[] {
    return Array.from(this.channels.keys())
  }

  getChannel(code: string): PaymentChannel {
    if (this.isProduction && code === 'mock') {
      this.logger.error('生产环境禁止使用 mock 渠道')
      throw new NotFoundException(`生产环境不支持渠道: ${code}`)
    }
    const channel = this.channels.get(code)
    if (!channel) {
      throw new NotFoundException(`支付渠道不存在: ${code}`)
    }
    return channel
  }

  /**
   * 获取已启用的渠道配置（60s 进程内缓存，仿 risk-engine ruleCache）
   *
   * 缓存 key：`config:{code}`。仅成功结果入缓存；未启用/不存在抛
   * NotFoundException 且不写缓存，确保「未启用」状态不被缓存 60s。
   */
  async getEnabledConfig(code: string) {
    const cacheKey = `config:${code}`
    const cached = this.enabledConfigCache.get(cacheKey)
    if (cached && Date.now() < cached.expiry) {
      return {
        code: cached.value.code,
        name: cached.value.name,
        config: cached.value.config,
      }
    }
    const config = await this.prisma.paymentChannelConfig.findUnique({
      where: { code },
    })
    if (!config || !config.enabled) {
      // 未启用渠道不缓存：避免「未启用」被缓存 60s 误导后续请求
      throw new NotFoundException(`支付渠道未启用: ${code}`)
    }
    let parsed: ChannelConfig = {}
    try {
      parsed = this.crypto.decryptConfigValues(
        JSON.parse(config.config) as Record<string, unknown>,
      ) as ChannelConfig
    } catch {
      this.logger.warn(`渠道 ${code} 配置解析失败，使用空配置`)
    }
    const result = {
      code: config.code,
      name: config.name,
      config: parsed,
    }
    this.enabledConfigCache.set(cacheKey, {
      value: result,
      expiry: Date.now() + this.CONFIG_CACHE_TTL_MS,
    })
    return result
  }

  /**
   * 清除渠道配置缓存（公共方法，仿 risk-engine clearCache）
   *
   * 供管理员改渠道配置（create/update/delete）时调用，使新配置即时生效。
   * 多副本部署时各副本需各自调用（或等待 TTL 自然过期，最多 60s）。
   */
  clearChannelConfigCache(): void {
    this.enabledConfigCache.clear()
  }
}
