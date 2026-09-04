import { Injectable, Logger } from '@nestjs/common'
import {
  Connector,
  ConnectorMetadata,
  ConnectorConfig,
  ConnectorHealth,
  ConnectorStatus,
} from '../connector.interface'
import { AlipayChannel } from '../channels/alipay.channel'
import { RechargeRequest, ChannelConfig } from '../payment-channel.interface'

/**
 * 支付宝 Connector 适配器
 *
 * 通过适配器模式将 AlipayChannel 包装为标准 Connector 接口。
 */
@Injectable()
export class AlipayConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'alipay',
    displayName: '支付宝',
    capabilities: ['RECHARGE', 'PAYOUT', 'REFUND', 'BALANCE_QUERY'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['page', 'wap', 'app'],
    version: '3.0.0',
  }

  private readonly logger = new Logger(AlipayConnector.name)
  private config: ConnectorConfig = {
    name: 'alipay',
    displayName: '支付宝',
    capabilities: ['RECHARGE', 'PAYOUT', 'REFUND', 'BALANCE_QUERY'],
    priority: 90,
    timeout: 30_000,
    retryConfig: {
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    },
  }

  constructor(private readonly channel: AlipayChannel) {}

  getConfig(): ConnectorConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<ConnectorConfig>): void {
    this.config = { ...this.config, ...config }
  }

  async createPayment(request: RechargeRequest): Promise<any & { connectorOrderId: string }> {
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
    try {
      // 通过查询一个不存在的订单做连通性验证（支付宝正常响应返回错误码即表示可达）
      const result = await this.channel.queryOrder(`__healthcheck_${Date.now()}__`, {})
      const latency = Date.now() - startTime
      return {
        status: 'ACTIVE',
        lastChecked: new Date(),
        latency,
        errorRate: 0,
      }
    } catch (error) {
      return {
        status: 'DEGRADED',
        lastChecked: new Date(),
        latency: Date.now() - startTime,
        errorRate: 1,
        errorMessage: error instanceof Error ? error.message : 'Health check failed',
      }
    }
  }
}
