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
  // 两个方法各自独立 Map，value 结构不同（getEnabledConfig 返回
  // {code,name,type,config}，getChannelByType 返回 {channel,config,code}），
  // 拆分后类型精确收窄，避免联合类型导致字段访问报错。
  private readonly enabledConfigCache = new Map<
    string,
    { value: { code: string; name: string; type: string; config: ChannelConfig }; expiry: number }
  >()
  private readonly byTypeCache = new Map<
    string,
    {
      value: { channel: PaymentChannel; config: ChannelConfig; code: string } | null
      expiry: number
    }
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
        type: cached.value.type,
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
      type: config.type,
      config: parsed,
    }
    this.enabledConfigCache.set(cacheKey, {
      value: result,
      expiry: Date.now() + this.CONFIG_CACHE_TTL_MS,
    })
    return result
  }

  /**
   * 按类型获取优先级最高的启用渠道（60s 进程内缓存）
   *
   * 缓存 key：`byType:{type}`。命中且未过期时直接返回，跳过 DB + AES 解密。
   * 命中成功结果时缓存；开发环境 mock 降级结果同样入缓存（mock 配置恒定
   * 为空对象，无凭据解密开销，缓存收益为省 1 次 DB 查）。
   */
  async getChannelByType(type: 'RECHARGE' | 'PAYOUT'): Promise<{
    channel: PaymentChannel
    config: ChannelConfig
    code: string
  } | null> {
    const cacheKey = `byType:${type}`
    const cached = this.byTypeCache.get(cacheKey)
    if (cached && Date.now() < cached.expiry) {
      if (cached.value === null) return null
      return {
        channel: cached.value.channel,
        config: cached.value.config,
        code: cached.value.code,
      }
    }

    const configs = await this.prisma.paymentChannelConfig.findMany({
      where: {
        enabled: true,
        OR: [{ type }, { type: 'BOTH' }],
      },
      orderBy: { priority: 'desc' },
    })

    let result:
      | { channel: PaymentChannel; config: ChannelConfig; code: string }
      | null = null

    for (const config of configs) {
      const channel = this.channels.get(config.code)
      if (channel) {
        let parsed: ChannelConfig = {}
        try {
          parsed = this.crypto.decryptConfigValues(
            JSON.parse(config.config) as Record<string, unknown>,
          ) as ChannelConfig
        } catch {
          // ignore
        }
        result = { channel, config: parsed, code: config.code }
        break
      }
    }

    // 没有配置渠道时，仅开发环境降级到 mock
    // 生产环境必须显式配置真实渠道，防止硬编码密钥泄露导致伪造回调
    if (!result && !this.isProduction && this.channels.has('mock')) {
      this.logger.warn(`未配置${type}渠道，开发环境降级到 mock 渠道`)
      result = {
        channel: this.channels.get('mock')!,
        config: {},
        code: 'mock',
      }
    }

    if (!result) {
      this.logger.error(
        `未配置可用的${type}渠道${this.isProduction ? '（生产环境不允许降级到 mock）' : ''}`,
      )
      // 成功结果（含 mock 降级）与「无可用渠道 null」均入缓存
      // （null 表示该 type 当前无可用配置，60s 内重试无意义）
      this.byTypeCache.set(cacheKey, {
        value: result,
        expiry: Date.now() + this.CONFIG_CACHE_TTL_MS,
      })
      return null
    }

    this.byTypeCache.set(cacheKey, {
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
    this.byTypeCache.clear()
  }
}
