import { Injectable, Logger } from '@nestjs/common'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { ConnectorRegistry } from './connector.registry'
import { ConnectorRouter, RetryPolicy } from './connector-router'
import { ConnectorCapability } from './connector.interface'
import {
  ChannelConfig,
  OrderQueryResult,
  PayoutQueryResult,
  PayoutRequest,
  PayoutResponse,
  PaymentChannel,
  RechargeRequest,
  RechargeResponse,
  RefundQueryResult,
  RefundRequest,
  RefundResponse,
} from './payment-channel.interface'

/** 渠道编码 → 连接器元数据名称（metadata.name）映射 */
export const CHANNEL_CONNECTOR_NAME: Record<string, string> = {
  wechat: 'wechat_pay',
  alipay: 'alipay',
  mock: 'mock',
  unionpay: 'unionpay',
  stripe: 'stripe',
}

/**
 * 支付渠道桥接层
 *
 * 将业务服务的外呼（充值/代付/退款/查询）统一改经 ConnectorRouter 路由，
 * 同时保持"渠道实例与 DB 配置仍由 PaymentChannelRegistry 提供"：
 * - 渠道选择、配置加载、验签/回调解析等本地能力：走 PaymentChannelRegistry + 原始渠道
 * - 真正的外呼（网络调用）：经 ConnectorRouter 获得统一重试与健康感知
 * - 渠道无对应连接器（未注册）时回退直连渠道，保证存量功能不受影响
 */
@Injectable()
export class PaymentChannelBridge {
  private readonly logger = new Logger(PaymentChannelBridge.name)

  constructor(
    private readonly channelRegistry: PaymentChannelRegistry,
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly connectorRouter: ConnectorRouter,
  ) {}

  /** 发起充值（RECHARGE 外呼） */
  createRecharge(code: string, request: RechargeRequest): Promise<RechargeResponse> {
    return this.routeToChannel('RECHARGE', code, request, (channel) =>
      channel.createRecharge(request),
    )
  }

  /** 发起代付（PAYOUT 外呼） */
  createPayout(code: string, request: PayoutRequest): Promise<PayoutResponse> {
    return this.routeToChannel('PAYOUT', code, request, (channel) =>
      channel.createPayout(request),
    )
  }

  /** 发起退款（REFUND 外呼） */
  refund(code: string, request: RefundRequest): Promise<RefundResponse> {
    return this.routeToChannel('REFUND', code, request, (channel) => channel.refund(request))
  }

  /** 查询退款状态（REFUND 外呼） */
  queryRefund(
    code: string,
    channelRefundNo: string,
    channelConfig: ChannelConfig,
  ): Promise<RefundQueryResult> {
    return this.routeToChannel('REFUND', code, { channelRefundNo }, (channel) =>
      channel.queryRefund(channelRefundNo, channelConfig),
    )
  }

  /** 查询代付状态（PAYOUT 外呼） */
  queryPayout(
    code: string,
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<PayoutQueryResult> {
    return this.routeToChannel('PAYOUT', code, { channelOrderNo }, (channel) =>
      channel.queryPayout(channelOrderNo, channelConfig),
    )
  }

  /** 查询支付订单状态（RECHARGE 外呼） */
  queryOrder(
    code: string,
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<OrderQueryResult> {
    return this.routeToChannel('RECHARGE', code, { channelOrderNo }, (channel) =>
      channel.queryOrder(channelOrderNo, channelConfig),
    )
  }

  /**
   * 统一外呼入口：
   * 1. 渠道实例由 PaymentChannelRegistry 按编码解析（同步、无 DB）
   * 2. 若该渠道已注册对应连接器，则经 ConnectorRouter 路由（preferredName 精确匹配，
   *    重试仅对携带幂等键的请求启用——见 ConnectorRouter.canSafelyRetry，
   *    无键请求失败即返回，防止渠道双下单/双放款）
   * 3. 未注册连接器时回退直连渠道，保持可用性
   */
  private async routeToChannel<R>(
    capability: ConnectorCapability,
    channelCode: string,
    request: unknown,
    requestFn: (channel: PaymentChannel) => Promise<R>,
    retryPolicy?: RetryPolicy,
  ): Promise<R> {
    const channel = this.channelRegistry.getChannel(channelCode)
    const connectorName = CHANNEL_CONNECTOR_NAME[channelCode] ?? channelCode

    if (!this.connectorRegistry.get(connectorName)) {
      this.logger.warn(
        `渠道 ${channelCode} 无对应连接器 ${connectorName}，本次调用直连渠道（未走路由器）`,
      )
      return requestFn(channel)
    }

    const { result } = await this.connectorRouter.route(
      capability,
      request,
      () => requestFn(channel),
      retryPolicy,
      { preferredName: connectorName },
    )
    return result
  }
}
