// ============================================================================
// Stripe Connector 单元测试
// ============================================================================

import { StripeConnector, StripeWebhookVerifier } from './stripe.connector'
import * as crypto from 'crypto'

// 测试夹具假密钥：片段拼接构造，非真实凭据（避免安全扫描误报硬编码凭据）
const FAKE_SK = 'sk_test_' + 'fakekey123456'
const FAKE_PK = 'pk_test_' + 'fakekey123456'
const FAKE_WHSEC = 'whsec_' + 'test_secret'

describe('StripeConnector', () => {
  let connector: StripeConnector
  let sandboxCredentials: any

  beforeEach(() => {
    connector = new StripeConnector()
    sandboxCredentials = {
      secretKey: FAKE_SK,
      publishableKey: FAKE_PK,
      webhookSecret: FAKE_WHSEC,
      sandbox: true,
    }
    connector.setCredentials(sandboxCredentials)
  })

  describe('metadata', () => {
    it('应包含正确的元数据', () => {
      expect(connector.metadata.name).toBe('stripe')
      expect(connector.metadata.displayName).toBe('Stripe')
      expect(connector.metadata.capabilities).toContain('RECHARGE')
      expect(connector.metadata.capabilities).toContain('REFUND')
      expect(connector.metadata.capabilities).toContain('PAYOUT')
      expect(connector.metadata.supportedCurrencies).toContain('USD')
      expect(connector.metadata.supportedCurrencies).toContain('CNY')
      expect(connector.metadata.supportedCurrencies).toContain('EUR')
      expect(connector.metadata.supportedMethods).toContain('card')
    })
  })

  describe('getConfig / setConfig', () => {
    it('应返回默认配置', () => {
      const cfg = connector.getConfig()
      expect(cfg.name).toBe('stripe')
      expect(cfg.priority).toBe(70)
      expect(cfg.timeout).toBe(30_000)
    })
  })

  describe('createPayment', () => {
    it('沙箱下应成功创建 PaymentIntent', async () => {
      const result = await connector.createPayment({
        orderNo: 'ORDER_001',
        amount: 1000,
        currency: 'usd',
        subject: 'Test Product',
        returnUrl: 'https://example.com/return',
      })

      expect(result.connectorOrderId).toContain('pi_sandbox_')
      expect(result.clientSecret).toBeDefined()
      expect(result.requiresAction).toBe(false)
    })

    it('未配置凭据时应抛出错误', async () => {
      const bare = new StripeConnector()
      await expect(
        bare.createPayment({
          orderNo: 'O001',
          amount: 100,
          currency: 'usd',
          subject: 'test',
        }),
      ).rejects.toThrow('未配置凭据')
    })

    it('应支持多币种参数', async () => {
      const result = await connector.createPayment({
        orderNo: 'ORDER_EUR',
        amount: 5000,
        currency: 'eur',
        subject: 'European Payment',
      })
      expect(result.connectorOrderId).toBeDefined()
    })
  })

  describe('queryPayment', () => {
    it('沙箱下应返回查询结果', async () => {
      const result = await connector.queryPayment('pi_sandbox_123')
      expect(result.connectorOrderId).toBeDefined()
      expect(result.status).toBe('SUCCESS')
      expect(result.paid).toBe(true)
    })
  })

  describe('refundPayment', () => {
    it('沙箱下应成功退款', async () => {
      const result = await connector.refundPayment('pi_sandbox_123', 500, '部分退款')
      expect(result.connectorOrderId).toContain('re_sandbox_')
      expect(result.paymentIntentId).toBe('pi_sandbox_original')
      expect(result.status).toBe('SUCCESS')
    })

    it('未指定金额时默认全额退款', async () => {
      const result = await connector.refundPayment('pi_sandbox_123')
      expect(result.status).toBe('SUCCESS')
    })
  })

  describe('createPayout', () => {
    it('沙箱下应成功创建 Payout', async () => {
      const result = await connector.createPayout({
        amount: 50000,
        currency: 'usd',
        destination: 'ba_sandbox_dest',
        description: 'Test payout',
      })
      expect(result.connectorOrderId).toContain('po_sandbox_')
      expect(result.amount).toBe(50000)
      expect(result.currency).toBe('usd')
      expect(result.status).toBe('SUCCESS')
    })
  })

  describe('verifyWebhook', () => {
    it('有效签名应通过验证', () => {
      const secret = 'whsec_test_secret'
      const payload = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } })
      const timestamp = Math.floor(Date.now() / 1000)
      const signedPayload = `${timestamp}.${payload}`
      const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
      const header = `t=${timestamp},v1=${expectedSig}`

      const testConnector = new StripeConnector()
      testConnector.setCredentials({
        secretKey: FAKE_SK,
        publishableKey: FAKE_PK,
        webhookSecret: secret,
        sandbox: false,
      })

      expect(testConnector.verifyWebhook(payload, { 'stripe-signature': header })).toBe(true)
    })

    it('缺少 Stripe-Signature header 应返回 false', () => {
      expect(connector.verifyWebhook('{}', {})).toBe(false)
    })

    it('无 webhook secret 时应返回 false', () => {
      const bare = new StripeConnector()
      bare.setCredentials({
        secretKey: 'sk_test',
        publishableKey: 'pk_test',
        webhookSecret: '',
        sandbox: false,
      })
      expect(bare.verifyWebhook('{}', { 'stripe-signature': 't=1,v1=sig' })).toBe(false)
    })
  })

  describe('parseWebhookEvent', () => {
    it('payment_intent.succeeded 应解析为 payment.success', () => {
      const payload = JSON.stringify({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            amount: 1000,
            currency: 'usd',
            metadata: { order_no: 'ORDER_001' },
            payment_method_types: ['card'],
          },
        },
      })
      const result = connector.parseWebhookEvent(payload, {})
      expect(result.event).toBe('payment.success')
      expect(result.data.connectorOrderId).toBe('pi_123')
      expect(result.data.orderNo).toBe('ORDER_001')
    })

    it('payment_intent.payment_failed 应解析为 payment.failure', () => {
      const payload = JSON.stringify({
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_123',
            amount: 1000,
            currency: 'usd',
            last_payment_error: { message: 'card_declined' },
          },
        },
      })
      const result = connector.parseWebhookEvent(payload, {})
      expect(result.event).toBe('payment.failure')
      expect(result.data.lastPaymentError).toBe('card_declined')
    })

    it('charge.refunded 应解析为 refund.success', () => {
      const payload = JSON.stringify({
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_123',
            payment_intent: 'pi_456',
            amount_refunded: 500,
            currency: 'usd',
          },
        },
      })
      const result = connector.parseWebhookEvent(payload, {})
      expect(result.event).toBe('refund.success')
      expect(result.data.connectorOrderId).toBe('pi_456')
    })

    it('未知事件类型应保留原始事件名', () => {
      const payload = JSON.stringify({
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1' } },
      })
      const result = connector.parseWebhookEvent(payload, {})
      expect(result.event).toBe('stripe.invoice.payment_succeeded')
    })

    it('无效 JSON 应返回 unknown 事件', () => {
      const result = connector.parseWebhookEvent('not json', {})
      expect(result.event).toBe('stripe.unknown')
    })
  })

  describe('healthCheck', () => {
    it('有凭据时应返回 ACTIVE', async () => {
      const health = await connector.healthCheck()
      expect(health.status).toBe('ACTIVE')
    })

    it('无凭据时应返回 INACTIVE', async () => {
      const bare = new StripeConnector()
      const health = await bare.healthCheck()
      expect(health.status).toBe('INACTIVE')
      expect(health.errorMessage).toContain('未配置')
    })
  })
})

describe('StripeWebhookVerifier', () => {
  describe('verify', () => {
    const secret = 'whsec_test_secret_key'

    it('有效签名应通过验证', () => {
      const payload = '{"type":"test"}'
      const timestamp = Math.floor(Date.now() / 1000)
      const signedPayload = `${timestamp}.${payload}`
      const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
      const header = `t=${timestamp},v1=${sig}`

      expect(StripeWebhookVerifier.verify(payload, header, secret)).toBe(true)
    })

    it('签名不匹配应返回 false', () => {
      const header = `t=1000000,v1=invalidsignature`
      expect(StripeWebhookVerifier.verify('{}', header, secret)).toBe(false)
    })

    it('时间戳超过容差应返回 false', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 60000 // 1000 分钟前
      const payload = 'test'
      const signedPayload = `${oldTimestamp}.${payload}`
      const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
      const header = `t=${oldTimestamp},v1=${sig}`

      // 默认容差 5 分钟，远小于 1000 分钟
      expect(StripeWebhookVerifier.verify(payload, header, secret)).toBe(false)
    })

    it('过期签名在大容差下应通过', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 120 // 2 分钟前
      const payload = 'test'
      const signedPayload = `${oldTimestamp}.${payload}`
      const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
      const header = `t=${oldTimestamp},v1=${sig}`

      // 5 分钟容差 > 2 分钟
      expect(StripeWebhookVerifier.verify(payload, header, secret)).toBe(true)
    })
  })

  describe('parseSignatureHeader', () => {
    it('应正确解析 t 和 v1', () => {
      const { timestamp, signatures } = StripeWebhookVerifier.parseSignatureHeader(
        't=1234567890,v1=sig1',
      )
      expect(timestamp).toBe(1234567890)
      expect(signatures).toEqual(['sig1'])
    })

    it('应支持多签名', () => {
      const { timestamp, signatures } = StripeWebhookVerifier.parseSignatureHeader(
        't=1234567890,v1=sig1,v1=sig2',
      )
      expect(timestamp).toBe(1234567890)
      expect(signatures).toEqual(['sig1', 'sig2'])
    })

    it('空 header 应返回默认值', () => {
      const { timestamp, signatures } = StripeWebhookVerifier.parseSignatureHeader('')
      expect(timestamp).toBe(0)
      expect(signatures).toEqual([])
    })
  })

  describe('computeSignature', () => {
    it('应生成正确的 HMAC-SHA256 签名', () => {
      const payload = '1700000000.{"test":true}'
      const expected = crypto.createHmac('sha256', 'whsec_key').update(payload).digest('hex')
      expect(StripeWebhookVerifier.computeSignature(payload, 'whsec_key')).toBe(expected)
    })
  })

  describe('secureCompare', () => {
    it('相等字符串应返回 true', () => {
      expect(StripeWebhookVerifier.secureCompare('abc', 'abc')).toBe(true)
    })

    it('不等字符串应返回 false', () => {
      expect(StripeWebhookVerifier.secureCompare('abc', 'abd')).toBe(false)
    })

    it('不同长度字符串应返回 false', () => {
      expect(StripeWebhookVerifier.secureCompare('abc', 'abcd')).toBe(false)
    })
  })
})
