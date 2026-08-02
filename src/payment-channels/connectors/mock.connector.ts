import { Injectable, Logger } from '@nestjs/common'
import {
  Connector,
  ConnectorMetadata,
  ConnectorConfig,
  ConnectorHealth,
  ConnectorStatus,
} from '../connector.interface'
import { MockChannel } from '../channels/mock.channel'
import { RechargeRequest, ChannelConfig } from '../payment-channel.interface'

/**
 * Mock 连接器（开发/测试用）
 *
 * 模拟所有 Connector 操作，不依赖外部服务。
 */
@Injectable()
export class MockConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'mock',
    displayName: '模拟渠道',
    capabilities: ['RECHARGE', 'PAYOUT', 'REFUND', 'BALANCE_QUERY', 'RECONCILIATION'],
    supportedCurrencies: ['CNY', 'USD'],
    supportedMethods: ['native', 'jsapi', 'h5', 'app'],
    version: '1.0.0',
  }

  private readonly logger = new Logger(MockConnector.name)
  private config: ConnectorConfig = {
    name: 'mock',
    displayName: '模拟渠道',
    capabilities: ['RECHARGE', 'PAYOUT', 'REFUND', 'BALANCE_QUERY', 'RECONCILIATION'],
    priority: 0,
    timeout: 5000,
    retryConfig: {
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
    },
  }

  // 内部健康状态（可模拟异常）
  private simulateFailure = false
  private simulateLatency = 0

  constructor(private readonly channel: MockChannel) {}

  getConfig(): ConnectorConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<ConnectorConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 设置模拟失败模式（测试用）
   */
  setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail
  }

  /**
   * 设置模拟延迟（测试用）
   */
  setSimulateLatency(ms: number): void {
    this.simulateLatency = ms
  }

  async createPayment(request: RechargeRequest): Promise<any & { connectorOrderId: string }> {
    if (this.simulateFailure) {
      throw new Error('Simulated connector failure')
    }
    if (this.simulateLatency > 0) {
      await this.sleep(this.simulateLatency)
    }

    const response = await this.channel.createRecharge(request)
    return {
      ...response,
      connectorOrderId: response.channelOrderNo,
    }
  }

  async queryPayment(connectorOrderId: string): Promise<any> {
    const response = await this.channel.queryOrder(connectorOrderId, {})
    return {
      ...response,
      connectorOrderId: response.channelOrderNo,
    }
  }

  async refundPayment(
    connectorOrderId: string,
    amount: number,
    reason?: string,
  ): Promise<any> {
    const response = await this.channel.refund({
      orderNo: '',
      refundNo: '',
      amount,
      reason,
      channelConfig: {} as ChannelConfig,
      channelOrderNo: connectorOrderId,
    })
    return {
      ...response,
      connectorOrderId: response.channelRefundNo,
    }
  }

  verifyWebhook(payload: string, headers: Record<string, string>): boolean {
    try {
      return this.channel.verifyWebhookSignature(payload, headers, {})
    } catch {
      return false
    }
  }

  parseWebhookEvent(
    payload: string,
    headers: Record<string, string>,
  ): { event: string; data: any } {
    const result = this.channel.parseRechargeCallback(payload, headers, {})
    return {
      event: result.status === 'SUCCESS' ? 'payment.success' : 'payment.failure',
      data: result,
    }
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const startTime = Date.now()

    if (this.simulateFailure) {
      await this.sleep(500)
      return {
        status: 'DEGRADED',
        lastChecked: new Date(),
        latency: Date.now() - startTime,
        errorRate: 1,
        errorMessage: 'Simulated health check failure',
      }
    }

    await this.sleep(Math.min(this.simulateLatency || 10, 1000))

    return {
      status: 'ACTIVE',
      lastChecked: new Date(),
      latency: Date.now() - startTime,
      errorRate: 0,
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
