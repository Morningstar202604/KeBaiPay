// ============================================================================
// Stripe Connector
//
// 参考 Hyperswitch Stripe connector 设计。
// 使用 Stripe PaymentIntent API 处理支付。
// 支持 3DS 认证流程、多币种、Webhook 签名验证。
// ============================================================================

import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import * as crypto from 'crypto'
import {
  Connector,
  ConnectorMetadata,
  ConnectorConfig,
  ConnectorHealth,
  ConnectorStatus,
} from '../connector.interface'

// ============================================================================
// Stripe 类型定义
// ============================================================================

/** Stripe 支付请求 */
export interface StripePaymentRequest {
  orderNo: string
  amount: number // 分（Stripe 中最小货币单位）
  currency: string // 如 usd, cny, eur
  subject: string
  description?: string
  /** 用户邮箱（可选，用于发票） */
  email?: string
  /** 元数据 */
  metadata?: Record<string, string>
  /** 成功/取消后的跳转地址(用于 3DS) */
  returnUrl?: string
  /** 支付方式类型 */
  paymentMethodTypes?: string[]
}

/** Stripe PaymentIntent 创建参数 */
export interface StripeCreatePaymentIntentParams {
  amount: number
  currency: string
  description?: string
  metadata?: Record<string, string>
  confirm: boolean
  return_url?: string
  payment_method_types?: string[]
  capture_method?: 'automatic' | 'manual'
}

/** Stripe 退款请求 */
export interface StripeRefundRequest {
  paymentIntentId: string
  amount?: number // 可选，不传则全额退款
  reason?: string
}

/** Stripe Payout(提现)请求 */
export interface StripePayoutRequest {
  amount: number
  currency: string
  destination: string // 外部账户 ID 或银行卡 token
  description?: string
  metadata?: Record<string, string>
  /** 我方单号：作为 Stripe Idempotency-Key 传递（P0-5），防止重试双放款 */
  orderNo?: string
}

/** Stripe Connector 凭据 */
export interface StripeCredentials {
  /** Secret API Key */
  secretKey: string
  /** Publishable Key */
  publishableKey: string
  /** Webhook Secret（用于验证 webhook 签名） */
  webhookSecret: string
  /** 是否使用测试环境 */
  sandbox?: boolean
}

// ============================================================================
// 端点常量
// ============================================================================

const STRIPE_API_BASE = 'https://api.stripe.com'
const STRIPE_API_TEST_BASE = 'https://api.stripe.com' // Stripe 通过 key 区分环境

const STRIPE_API_PATHS = {
  paymentIntents: '/v1/payment_intents',
  refunds: '/v1/refunds',
  payouts: '/v1/payouts',
  balance: '/v1/balance',
}

// Stripe 支持的货币列表（三位大写字母 ISO 4217）
const STRIPE_SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CNY', 'HKD',
  'SGD', 'KRW', 'THB', 'MYR', 'PHP', 'INR', 'BRL', 'MXN',
  'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF',
  'ILS', 'ZAR', 'AED', 'SAR', 'TRY',
]

// ============================================================================
// Stripe Webhook 签名验证
// ============================================================================

/**
 * Stripe Webhook 签名验证
 *
 * Stripe 通过 Stripe-Signature header 传递签名，格式：
 * Stripe-Signature: t=timestamp,v1=signature1,v1=signature2,...
 *
 * 核心逻辑：
 * 1. 从 header 中提取时间戳 t 和签名列表
 * 2. 构造签名载荷：timestamp.payload
 * 3. 使用 HMAC-SHA256 + webhook secret 计算期望签名
 * 4. 比较期望签名与 header 中的签名
 * 5. 可选验证时间戳新鲜度（默认 ±5 分钟）
 */
export class StripeWebhookVerifier {
  /**
   * 验证 Stripe webhook 签名
   *
   * @param payload 原始请求体（Buffer 或 string）
   * @param signatureHeader Stripe-Signature header 值
   * @param secret webhook secret（whsec_xxx）
   * @param toleranceMs 允许的时间偏差（默认 300000 = 5 分钟）
   */
  static verify(
    payload: string | Buffer,
    signatureHeader: string,
    secret: string,
    toleranceMs = 300_000,
  ): boolean {
    const payloadStr = typeof payload === 'string' ? payload : payload.toString('utf8')
    const signatureHeaderStr = typeof signatureHeader === 'string' ? signatureHeader : String(signatureHeader)

    // 解析 Stripe-Signature header
    const { timestamp, signatures } = StripeWebhookVerifier.parseSignatureHeader(signatureHeaderStr)

    if (!timestamp || signatures.length === 0) return false

    // 验证时间戳新鲜度（防止重放攻击）
    const now = Date.now()
    if (now - timestamp * 1000 > toleranceMs) {
      return false
    }

    // 构造签名字符串：timestamp.payload
    const signedPayload = `${timestamp}.${payloadStr}`

    // 计算期望签名
    const expectedSignature = StripeWebhookVerifier.computeSignature(signedPayload, secret)

    // 比较签名（使用 timingSafeEqual 防时序攻击）
    return signatures.some((sig) =>
      StripeWebhookVerifier.secureCompare(expectedSignature, sig),
    )
  }

  /**
   * 解析 Stripe-Signature header
   */
  static parseSignatureHeader(
    header: string,
  ): { timestamp: number; signatures: string[] } {
    const parts = header.split(',').map((p) => p.trim())
    let timestamp = 0
    const signatures: string[] = []

    for (const part of parts) {
      const [key, value] = part.split('=')
      if (key === 't') {
        timestamp = parseInt(value, 10)
      } else if (key === 'v1') {
        signatures.push(value)
      }
    }

    return { timestamp, signatures }
  }

  /**
   * 使用 HMAC-SHA256 计算签名
   */
  static computeSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(payload, 'utf8')
    return hmac.digest('hex')
  }

  /**
   * 安全的字符串比较（防时序攻击）
   */
  static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // 用 equal-length timing 防止基于长度的时序攻击
      const buf = Buffer.alloc(a.length)
      const bufB = Buffer.from(b, 'utf8')
      const bufA = Buffer.from(a, 'utf8')
      return crypto.timingSafeEqual(bufA, bufB.length === bufA.length ? bufB : buf)
    }
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  }
}

// ============================================================================
// Connector 实现
// ============================================================================

@Injectable()
export class StripeConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'stripe',
    displayName: 'Stripe',
    capabilities: ['RECHARGE', 'REFUND', 'PAYOUT'],
    supportedCurrencies: STRIPE_SUPPORTED_CURRENCIES,
    supportedMethods: ['card', 'wechat_pay', 'alipay', 'ideal', 'sofort'],
    version: '2024-11-20.acacia', // Stripe API 版本
  }

  private readonly logger = new Logger(StripeConnector.name)

  private config: ConnectorConfig = {
    name: 'stripe',
    displayName: 'Stripe',
    capabilities: ['RECHARGE', 'REFUND', 'PAYOUT'],
    priority: 70,
    timeout: 30_000,
    retryConfig: {
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    },
  }

  private credentials?: StripeCredentials

  constructor(private readonly httpService?: HttpService) {}

  getConfig(): ConnectorConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<ConnectorConfig>): void {
    this.config = { ...this.config, ...config }
    if (config.credentials) {
      this.credentials = config.credentials as unknown as StripeCredentials
    }
  }

  setCredentials(creds: StripeCredentials): void {
    this.credentials = creds
  }

  // ==================================================================
  // Connector 核心方法
  // ==================================================================

  /**
   * 创建 Stripe PaymentIntent
   *
   * 支持：
   * - 多币种
   * - payment_method_types 自定义
   * - 3DS 认证（通过 return_url）
   * - 元数据传递
   */
  async createPayment(request: StripePaymentRequest): Promise<any & { connectorOrderId: string }> {
    this.assertCredentials()

    const { orderNo, amount, currency, subject, description, email, metadata, returnUrl, paymentMethodTypes } = request

    const params: StripeCreatePaymentIntentParams = {
      amount,
      currency: currency.toLowerCase(),
      description: description || subject,
      metadata: {
        order_no: orderNo,
        ...metadata,
      },
      confirm: false, // 不自动确认，由客户端 3DS 后确认
      return_url: returnUrl,
      payment_method_types: paymentMethodTypes || ['card'],
      capture_method: 'automatic',
    }

    const response = await this.stripePost<Record<string, any>>(
      STRIPE_API_PATHS.paymentIntents,
      this.toFormData(params),
      orderNo, // P0-5：以我方单号作为 Stripe 幂等键，重试不会双开 PaymentIntent
    )

    return {
      connectorOrderId: response.id,
      clientSecret: response.client_secret,
      status: this.mapPaymentIntentStatus(response.status),
      amount: response.amount,
      currency: response.currency,
      nextAction: response.next_action || null,
      requiresAction: response.status === 'requires_action' || response.status === 'requires_confirmation',
    }
  }

  /**
   * 查询 PaymentIntent 状态
   */
  async queryPayment(connectorOrderId: string): Promise<any> {
    this.assertCredentials()

    const response = await this.stripeGet<Record<string, any>>(
      `${STRIPE_API_PATHS.paymentIntents}/${connectorOrderId}`,
    )

    return {
      connectorOrderId: response.id,
      status: this.mapPaymentIntentStatus(response.status),
      amount: response.amount,
      currency: response.currency,
      paid: response.status === 'succeeded',
      paymentMethod: response.payment_method_types,
      charges: response.charges?.data || [],
    }
  }

  /**
   * 退款
   *
   * 支持部分退款（指定 amount）
   */
  async refundPayment(
    connectorOrderId: string,
    amount?: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<any> {
    this.assertCredentials()

    const params: Record<string, string> = {
      payment_intent: connectorOrderId,
    }

    if (amount !== undefined && amount !== null) {
      params.amount = String(amount)
    }

    if (reason) {
      params.reason = reason.length > 22 ? reason.substring(0, 22) : reason
      params.metadata_reason = reason
    }

    const response = await this.stripePost<Record<string, any>>(
      STRIPE_API_PATHS.refunds,
      this.toFormData(params),
      // P0-5：优先用调用方幂等键；否则按 intent+金额派生确定性键（同参数重试安全）
      idempotencyKey || `${connectorOrderId}:${amount ?? 'full'}`,
    )

    return {
      connectorOrderId: response.id,
      paymentIntentId: response.payment_intent,
      amount: response.amount,
      status: this.mapRefundStatus(response.status),
      reason: response.reason,
      failureReason: response.failure_reason,
    }
  }

  /**
   * Stripe Payout（提现到外部账户）
   *
   * 需要 Stripe Connect 或标准 Payout 功能。
   */
  async createPayout(request: StripePayoutRequest): Promise<any & { connectorOrderId: string }> {
    this.assertCredentials()

    const params: Record<string, string> = {
      amount: String(request.amount),
      currency: request.currency.toLowerCase(),
      destination: request.destination,
      method: 'instant', // instant: 即时到账（费用高）, standard: 标准 T+1
    }

    if (request.description) {
      params.description = request.description
    }

    const response = await this.stripePost<Record<string, any>>(
      STRIPE_API_PATHS.payouts,
      this.toFormData(params),
      request.orderNo, // P0-5：幂等键，防止超时重试双放款
    )

    return {
      connectorOrderId: response.id,
      amount: response.amount,
      currency: response.currency,
      status: this.mapPayoutStatus(response.status),
      arrivalDate: new Date(response.arrival_date * 1000).toISOString(),
    }
  }

  /**
   * 验证 Stripe Webhook 签名
   *
   * 支持 Stripe-Signature header 格式。
   */
  verifyWebhook(payload: string, headers: Record<string, string>): boolean {
    try {
      const signatureHeader = headers['stripe-signature'] || headers['Stripe-Signature']
      if (!signatureHeader) {
        this.logger.warn('Stripe 回调缺少 Stripe-Signature header')
        return false
      }

      if (!this.credentials?.webhookSecret) {
        this.logger.warn('未配置 Stripe webhook secret，无法验签')
        return false
      }

      return StripeWebhookVerifier.verify(payload, signatureHeader, this.credentials.webhookSecret)
    } catch (error) {
      this.logger.error(`Stripe webhook 验签失败: ${error}`)
      return false
    }
  }

  /**
   * 解析 Stripe Webhook 事件
   */
  parseWebhookEvent(
    payload: string,
    headers: Record<string, string>,
  ): { event: string; data: any } {
    try {
      const event = JSON.parse(payload)
      const eventType = event.type || 'unknown'
      const eventData = event.data?.object || event

      switch (eventType) {
        case 'payment_intent.succeeded':
          return {
            event: 'payment.success',
            data: {
              connectorOrderId: eventData.id,
              amount: eventData.amount,
              currency: eventData.currency,
              orderNo: eventData.metadata?.order_no,
              paymentMethod: eventData.payment_method_types,
            },
          }

        case 'payment_intent.payment_failed':
          return {
            event: 'payment.failure',
            data: {
              connectorOrderId: eventData.id,
              amount: eventData.amount,
              currency: eventData.currency,
              orderNo: eventData.metadata?.order_no,
              lastPaymentError: eventData.last_payment_error?.message,
            },
          }

        case 'charge.refunded':
          return {
            event: 'refund.success',
            data: {
              connectorOrderId: eventData.payment_intent,
              refundId: eventData.id,
              amount: eventData.amount_refunded,
              currency: eventData.currency,
            },
          }

        case 'payout.paid':
          return {
            event: 'payout.success',
            data: {
              connectorOrderId: eventData.id,
              amount: eventData.amount,
              currency: eventData.currency,
              destination: eventData.destination,
              arrivalDate: new Date(eventData.arrival_date * 1000).toISOString(),
            },
          }

        case 'payout.failed':
          return {
            event: 'payout.failure',
            data: {
              connectorOrderId: eventData.id,
              amount: eventData.amount,
              currency: eventData.currency,
              destination: eventData.destination,
              failureMessage: eventData.failure_message,
            },
          }

        default:
          return {
            event: `stripe.${eventType}`,
            data: eventData,
          }
      }
    } catch (error) {
      this.logger.error(`Stripe webhook 事件解析失败: ${error}`)
      return {
        event: 'stripe.unknown',
        data: { rawPayload: payload },
      }
    }
  }

  /**
   * 健康检查
   *
   * 调用 Stripe Balance API 确认 API 密钥有效且账户正常。
   */
  async healthCheck(): Promise<ConnectorHealth> {
    const startTime = Date.now()

    try {
      if (!this.credentials?.secretKey) {
        return {
          status: 'INACTIVE',
          lastChecked: new Date(),
          latency: Date.now() - startTime,
          errorRate: 1,
          errorMessage: '未配置 Stripe secret key',
        }
      }

      // 尝试获取余额（轻量级端点，确认密钥有效）
      const balance = await this.stripeGet<Record<string, any>>(
        STRIPE_API_PATHS.balance,
      )

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
        errorMessage: error instanceof Error ? error.message : '无法连接 Stripe API',
      }
    }
  }

  // ==================================================================
  // 辅助方法
  // ==================================================================

  private assertCredentials(): void {
    if (!this.credentials?.secretKey) {
      throw new Error('Stripe Connector 未配置凭据')
    }
  }

  /**
   * 转换 PaymentIntent 状态为系统内部状态
   */
  private mapPaymentIntentStatus(stripeStatus: string): string {
    switch (stripeStatus) {
      case 'succeeded':
        return 'SUCCESS'
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
      case 'processing':
        return 'PENDING'
      case 'canceled':
        return 'FAILED'
      default:
        return 'PENDING'
    }
  }

  /**
   * 转换退款状态
   */
  private mapRefundStatus(stripeStatus: string): string {
    switch (stripeStatus) {
      case 'succeeded':
        return 'SUCCESS'
      case 'pending':
      case 'requires_action':
        return 'PENDING'
      case 'failed':
      case 'canceled':
        return 'FAILED'
      default:
        return 'PENDING'
    }
  }

  /**
   * 转换 Payout 状态
   */
  private mapPayoutStatus(stripeStatus: string): string {
    switch (stripeStatus) {
      case 'paid':
        return 'SUCCESS'
      case 'pending':
      case 'in_transit':
        return 'PROCESSING'
      case 'failed':
      case 'canceled':
        return 'FAILED'
      default:
        return 'PROCESSING'
    }
  }

  /**
   * 转换为 form-urlencoded 数据
   */
  private toFormData(params: Record<string, any>): string {
    const parts: string[] = []
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) {
          parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(String(item))}`)
        }
      } else if (typeof value === 'object') {
        for (const [subKey, subValue] of Object.entries(value)) {
          if (subValue !== null && subValue !== undefined) {
            parts.push(
              `${encodeURIComponent(key)}[${encodeURIComponent(subKey)}]=${encodeURIComponent(String(subValue))}`,
            )
          }
        }
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      }
    }
    return parts.join('&')
  }

  /**
   * Stripe GET 请求
   */
  private async stripeGet<T>(path: string): Promise<T> {
    this.assertCredentials()
    const creds = this.credentials!

    if (creds.sandbox) {
      return this.mockResponse('GET', path) as T
    }

    if (!this.httpService) {
      throw new Error('Stripe Connector 未注入 HttpService，请在模块中提供。Path=' + path)
    }
    const res = await firstValueFrom(
      this.httpService.get(`${STRIPE_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${creds.secretKey}` },
        timeout: this.config.timeout,
      }),
    )
    return res.data as T
  }

  /**
   * Stripe POST 请求
   *
   * P0-5：idempotencyKey 非空时将作为 `Idempotency-Key` header 发送
   * （Stripe 官方幂等机制，24h 内同键重放返回同一结果）。
   */
  private async stripePost<T>(path: string, body: string, idempotencyKey?: string): Promise<T> {
    this.assertCredentials()
    const creds = this.credentials!

    if (creds.sandbox) {
      return this.mockResponse('POST', path) as T
    }

    if (!this.httpService) {
      throw new Error('Stripe Connector 未注入 HttpService，请在模块中提供。Path=' + path)
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey
    }
    const res = await firstValueFrom(
      this.httpService.post(`${STRIPE_API_BASE}${path}`, body, {
        headers,
        timeout: this.config.timeout,
      }),
    )
    return res.data as T
  }

  /**
   * 沙箱模拟响应
   */
  private mockResponse(method: string, path: string): Record<string, any> {
    if (method === 'GET') {
      if (path.includes('/v1/balance')) {
        return {
          object: 'balance',
          available: [{ amount: 1000000, currency: 'usd', source_types: { card: 1000000 } }],
          pending: [{ amount: 50000, currency: 'usd', source_types: { card: 50000 } }],
        }
      }

      if (path.includes('/v1/payment_intents/')) {
        return {
          id: 'pi_sandbox_' + Date.now(),
          object: 'payment_intent',
          amount: 1000,
          currency: 'usd',
          status: 'succeeded',
          payment_method_types: ['card'],
          charges: {
            data: [{
              id: 'ch_sandbox',
              amount: 1000,
              currency: 'usd',
              paid: true,
              status: 'succeeded',
            }],
          },
        }
      }
    }

    if (method === 'POST') {
      if (path.includes('/v1/payment_intents')) {
        return {
          id: 'pi_sandbox_' + Date.now(),
          object: 'payment_intent',
          amount: 1000,
          currency: 'usd',
          status: 'requires_payment_method',
          client_secret: 'pi_sandbox_secret_abc123',
          next_action: null,
        }
      }

      if (path.includes('/v1/refunds')) {
        return {
          id: 're_sandbox_' + Date.now(),
          object: 'refund',
          amount: 1000,
          currency: 'usd',
          status: 'succeeded',
          payment_intent: 'pi_sandbox_original',
        }
      }

      if (path.includes('/v1/payouts')) {
        return {
          id: 'po_sandbox_' + Date.now(),
          object: 'payout',
          amount: 50000,
          currency: 'usd',
          status: 'paid',
          arrival_date: Math.floor(Date.now() / 1000) + 86400,
          destination: 'ba_sandbox_dest',
        }
      }
    }

    return { error: { type: 'api_error', message: 'Mock not implemented for this path' } }
  }
}

export default StripeConnector
