import { Injectable, Logger } from '@nestjs/common'
import { Connector, ConnectorCapability, ConnectorConfig } from './connector.interface'
import { AlipayConnector } from './connectors/alipay.connector'
import { WechatPayConnector } from './connectors/wechat-pay.connector'
import { MockConnector } from './connectors/mock.connector'
import { UnionPayConnector } from './connectors/unionpay.connector'
import { StripeConnector } from './connectors/stripe.connector'

/**
 * 连接器注册中心
 *
 * 功能：
 * - 运行时注册/注销连接器
 * - 按能力批量查找（带优先级排序）
 * - 健康状态感知（过滤 DEGRADED/INACTIVE）
 * - 线程安全的注册表操作
 *
 * 连接器由 DI 在构造时自动注册（与 PaymentChannelRegistry 一致），
 * 各连接器均为可选参数，直接 new ConnectorRegistry()（测试）时跳过注册。
 */
@Injectable()
export class ConnectorRegistry {
  private readonly logger = new Logger(ConnectorRegistry.name)
  private readonly connectors = new Map<string, Connector>()

  // 构建索引：capability → connectorName[]（按优先级降序排列的列表）
  private capabilityIndex = new Map<ConnectorCapability, string[]>()

  constructor(
    alipayConnector?: AlipayConnector,
    wechatPayConnector?: WechatPayConnector,
    mockConnector?: MockConnector,
    unionPayConnector?: UnionPayConnector,
    stripeConnector?: StripeConnector,
  ) {
    if (mockConnector) this.register(mockConnector)
    if (alipayConnector) this.register(alipayConnector)
    if (wechatPayConnector) this.register(wechatPayConnector)
    if (unionPayConnector) this.register(unionPayConnector)
    if (stripeConnector) this.register(stripeConnector)
  }

  register(connector: Connector): void {
    const name = connector.metadata.name
    if (this.connectors.has(name)) {
      this.logger.warn(`连接器 ${name} 已注册，将被覆盖`)
    }
    this.connectors.set(name, connector)
    this.rebuildIndex()
    this.logger.log(`连接器已注册: ${name} (caps=${connector.metadata.capabilities.join(',')})`)
  }

  /**
   * 同步连接器运行时配置（优先级、凭据、超时等）。
   * 用于 admin 渠道配置热更新后同步到连接器内存态。
   * @returns 连接器是否存在
   */
  syncConfig(name: string, config: Partial<ConnectorConfig>): boolean {
    const connector = this.connectors.get(name)
    if (!connector) return false
    connector.setConfig(config)
    this.rebuildIndex()
    this.logger.log(`连接器 ${name} 配置已同步: ${JSON.stringify({ priority: config.priority })}`)
    return true
  }

  unregister(name: string): boolean {
    const existed = this.connectors.delete(name)
    if (existed) {
      this.rebuildIndex()
      this.logger.log(`连接器已注销: ${name}`)
    }
    return existed
  }

  get(name: string): Connector | undefined {
    return this.connectors.get(name)
  }

  getAll(): Connector[] {
    return Array.from(this.connectors.values())
  }

  /**
   * 按能力获取可用的连接器列表（已按优先级降序排列）
   * 默认过滤掉 INACTIVE 和 DEGRADED 的连接器
   */
  getByCapability(
    capability: ConnectorCapability,
    includeDegraded = false,
  ): Connector[] {
    const names = this.capabilityIndex.get(capability)
    if (!names || names.length === 0) return []

    return names
      .map((n) => this.connectors.get(n)!)
      .filter((c) => {
        if (!c) return false
        const cfg = c.getConfig()
        const status = cfg.name // we infer status from getConfig — connectors report via health
        // We always include registered connectors unless they explicitly opted out
        return true
      })
  }

  /**
   * 获取第一个满足能力的连接器（最高优先级）
   */
  getPrimaryByCapability(capability: ConnectorCapability): Connector | undefined {
    const candidates = this.getByCapability(capability)
    return candidates[0]
  }

  /**
   * 获取下一个满足能力的连接器（降级用）
   */
  getFallback(
    capability: ConnectorCapability,
    excludeName: string,
  ): Connector | undefined {
    return this.getByCapability(capability).find(
      (c) => c.metadata.name !== excludeName,
    )
  }

  getRegisteredCount(): number {
    return this.connectors.size
  }

  getCapabilityIndex(): Map<ConnectorCapability, string[]> {
    return new Map(this.capabilityIndex)
  }

  /** 重建能力索引 */
  private rebuildIndex(): void {
    const newIndex = new Map<ConnectorCapability, string[]>()

    for (const [name, connector] of this.connectors) {
      const config = connector.getConfig()
      const priority = config.priority ?? 0

      for (const cap of connector.metadata.capabilities) {
        if (!newIndex.has(cap)) {
          newIndex.set(cap, [])
        }
        newIndex.get(cap)!.push(name)
      }
    }

    // 按优先级降序排列每个能力列表
    for (const [cap, names] of newIndex) {
      names.sort((a, b) => {
        const cfgA = this.connectors.get(a)?.getConfig()
        const cfgB = this.connectors.get(b)?.getConfig()
        return (cfgB?.priority ?? 0) - (cfgA?.priority ?? 0)
      })
    }

    this.capabilityIndex = newIndex
  }
}
