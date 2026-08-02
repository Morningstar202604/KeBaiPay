// ============================================================================
// 银联 UnionPay Connector 单元测试
// ============================================================================

import { UnionPayConnector, UnionPaySignUtil } from './unionpay.connector'

describe('UnionPayConnector', () => {
  let connector: UnionPayConnector
  let sandboxCredentials: any

  beforeEach(() => {
    connector = new UnionPayConnector()
    sandboxCredentials = {
      merchantId: '777290058168048',
      signCert: 'FAKE_CERT_PEM',
      signCertPwd: '000000',
      encryptCert: 'FAKE_PUBLIC_KEY',
      notifyUrl: 'https://example.com/notify',
      frontUrl: 'https://example.com/front',
      sandbox: true,
    }
    connector.setCredentials(sandboxCredentials)
  })

  describe('metadata', () => {
    it('应包含正确的元数据', () => {
      expect(connector.metadata.name).toBe('unionpay')
      expect(connector.metadata.displayName).toBe('银联支付')
      expect(connector.metadata.capabilities).toContain('RECHARGE')
      expect(connector.metadata.capabilities).toContain('REFUND')
      expect(connector.metadata.capabilities).toContain('BALANCE_QUERY')
      expect(connector.metadata.capabilities).toContain('RECONCILIATION')
      expect(connector.metadata.supportedCurrencies).toEqual(['CNY'])
      expect(connector.metadata.version).toBe('5.1.0')
    })
  })

  describe('getConfig / setConfig', () => {
    it('应返回默认配置', () => {
      const cfg = connector.getConfig()
      expect(cfg.name).toBe('unionpay')
      expect(cfg.priority).toBe(80)
      expect(cfg.timeout).toBe(30_000)
      expect(cfg.retryConfig.maxRetries).toBe(2)
    })

    it('应支持局部配置更新', () => {
      connector.setConfig({ priority: 95, timeout: 60_000 })
      const cfg = connector.getConfig()
      expect(cfg.priority).toBe(95)
      expect(cfg.timeout).toBe(60_000)
      // 其他字段不变
      expect(cfg.name).toBe('unionpay')
    })
  })

  describe('createPayment', () => {
    it('应在沙箱模式下返回 tn', async () => {
      const result = await connector.createPayment({
        orderNo: 'ORDER20240101001',
        amount: 100,
        subject: '测试商品',
        notifyUrl: 'https://example.com/notify',
      })

      expect(result.tn).toBeDefined()
      expect(result.tn).toContain('SANDBOX_TN_')
      expect(result.connectorOrderId).toBe('ORDER20240101001')
      expect(result.respCode).toBe('00')
    })

    it('应在未配置凭据时抛出错误', async () => {
      const bare = new UnionPayConnector()
      await expect(
        bare.createPayment({
          orderNo: 'ORDER',
          amount: 100,
          subject: 'test',
          notifyUrl: 'https://example.com/notify',
        }),
      ).rejects.toThrow('未配置凭据')
    })
  })

  describe('queryPayment', () => {
    it('应在沙箱模式下返回查询结果', async () => {
      const result = await connector.queryPayment('ORDER20240101001')
      expect(result.connectorOrderId).toBe('ORDER20240101001')
      expect(result.queryId).toBeDefined()
      expect(result.respCode).toBe('00')
      expect(result.status).toBe('SUCCESS')
    })
  })

  describe('refundPayment', () => {
    it('应在沙箱模式下发起退款', async () => {
      const result = await connector.refundPayment(
        'ORDER20240101001',
        100,
        '用户申请退款',
      )
      expect(result.connectorOrderId).toBeDefined()
      expect(result.origOrderId).toBe('ORDER20240101001')
      expect(result.respCode).toBe('00')
    })
  })

  describe('verifyWebhook', () => {
    it('沙箱下应返回 true', () => {
      // 沙箱模式放宽验签
      const payload = 'respCode=00&orderId=ORDER001&txnAmt=100&signature=abc'
      expect(connector.verifyWebhook(payload, {})).toBe(true)
    })

    it('缺少 signature 应返回 false', () => {
      // 移除沙箱特征再测试
      const bare = new UnionPayConnector()
      bare.setCredentials({
        merchantId: 'test',
        signCert: 'TEST',
        signCertPwd: '123456',
        notifyUrl: 'https://example.com',
        sandbox: false,
      })
      expect(bare.verifyWebhook('respCode=00&orderId=O001', {})).toBe(false)
    })
  })

  describe('parseWebhookEvent', () => {
    it('respCode=00 应解析为 payment.success', () => {
      const payload =
        'respCode=00&orderId=ORDER001&txnAmt=100&queryId=Q001&traceNo=T001&traceTime=20240101010101&settleDate=20240101'
      const result = connector.parseWebhookEvent(payload, {})
      expect(result.event).toBe('payment.success')
      expect(result.data.orderId).toBe('ORDER001')
    })

    it('非 00 respCode 应解析为 payment.failure', () => {
      const payload = 'respCode=99&orderId=ORDER001&respMsg=余额不足'
      const result = connector.parseWebhookEvent(payload, {})
      expect(result.event).toBe('payment.failure')
      expect(result.data.respCode).toBe('99')
      expect(result.data.respMsg).toBe('余额不足')
    })
  })

  describe('healthCheck', () => {
    it('有完整凭据时应返回 ACTIVE', async () => {
      const health = await connector.healthCheck()
      expect(health.status).toBe('ACTIVE')
    })

    it('无凭据时应返回 INACTIVE', async () => {
      const bare = new UnionPayConnector()
      const health = await bare.healthCheck()
      expect(health.status).toBe('INACTIVE')
      expect(health.errorMessage).toContain('未配置银联凭据')
    })

    it('凭据不完整时应返回 INACTIVE', async () => {
      const bare = new UnionPayConnector()
      bare.setCredentials({
        merchantId: '',
        signCert: '',
        signCertPwd: '',
        notifyUrl: '',
        sandbox: false,
      })
      const health = await bare.healthCheck()
      expect(health.status).toBe('INACTIVE')
      expect(health.errorMessage).toContain('凭据不完整')
    })
  })

  describe('baseUrl', () => {
    it('沙箱时使用测试地址', () => {
      expect(connector.baseUrl).toBe('https://gateway.test.95516.com')
    })

    it('非沙箱时使用生产地址', () => {
      const bare = new UnionPayConnector()
      bare.setCredentials({
        merchantId: 'test',
        signCert: 'test',
        signCertPwd: 'test',
        notifyUrl: 'https://example.com',
        sandbox: false,
      })
      expect(bare.baseUrl).toBe('https://gateway.95516.com')
    })
  })
})

describe('UnionPaySignUtil', () => {
  describe('buildSignString', () => {
    it('应按 ASCII 顺序排序并拼接', () => {
      const data = { b: '2', a: '1', c: '3' }
      const result = UnionPaySignUtil.buildSignString(data)
      expect(result).toBe('a=1&b=2&c=3')
    })

    it('应排除 signature、signMethod 和空值', () => {
      const data = {
        signature: 'ABC',
        signMethod: '01',
        key1: 'val1',
        key2: '',
        key3: 'val3',
      }
      const result = UnionPaySignUtil.buildSignString(data)
      expect(result).toBe('key1=val1&key3=val3')
      expect(result).not.toContain('signature')
      expect(result).not.toContain('signMethod')
      expect(result).not.toContain('key2')
    })

    it('空数据应返回空字符串', () => {
      expect(UnionPaySignUtil.buildSignString({})).toBe('')
    })
  })
})
