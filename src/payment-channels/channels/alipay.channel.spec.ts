// ============================================================================
// AlipayChannel 单元测试（覆盖无网络路径：签名/验签/下单 URL 构建）
// ============================================================================

import { AlipayChannel } from './alipay.channel'
import { generateKeyPairSync, createSign } from 'crypto'
import { KBErrorCodes } from '../../common/error-codes'

function buildKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey, privateKey }
}

/** 按支付宝规范对待签名参数（排除 sign、过滤空值、排序） */
function signNotifyParams(params: Record<string, string>, privateKey: string): string {
  const sortedKeys = Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== '')
    .sort()
  const signContent = sortedKeys.map(k => `${k}=${params[k]}`).join('&')
  return createSign('RSA-SHA256').update(signContent).sign(privateKey, 'base64')
}

function buildRawBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

describe('AlipayChannel', () => {
  let channel: AlipayChannel
  let keyPair: { publicKey: string; privateKey: string }

  beforeEach(() => {
    channel = new AlipayChannel()
    keyPair = buildKeyPair()
  })

  describe('verifyWebhookSignature', () => {
    it('未配置支付宝公钥时返回 false', () => {
      const params = { out_trade_no: 'T1', trade_status: 'TRADE_SUCCESS', total_amount: '1.00' }
      expect(channel.verifyWebhookSignature(buildRawBody(params), {}, {})).toBe(false)
    })

    it('合法签名应验证通过', () => {
      const params: Record<string, string> = {
        app_id: '2021000000000000',
        out_trade_no: 'T20260801001',
        trade_no: '2026080122000000000000000001',
        trade_status: 'TRADE_SUCCESS',
        total_amount: '100.00',
        seller_id: '2088000000000000',
      }
      params.sign = signNotifyParams(params, keyPair.privateKey)
      const cfg = { appId: '2021000000000000', privateKey: keyPair.privateKey, alipayPublicKey: keyPair.publicKey }
      expect(channel.verifyWebhookSignature(buildRawBody(params), {}, cfg)).toBe(true)
    })

    it('被篡改的签名应验证失败', () => {
      const params: Record<string, string> = {
        app_id: '2021000000000000',
        out_trade_no: 'T20260801001',
        trade_status: 'TRADE_SUCCESS',
        total_amount: '100.00',
      }
      params.sign = signNotifyParams(params, keyPair.privateKey)
      params.total_amount = '999.99'
      const cfg = { appId: '2021000000000000', privateKey: keyPair.privateKey, alipayPublicKey: keyPair.publicKey }
      expect(channel.verifyWebhookSignature(buildRawBody(params), {}, cfg)).toBe(false)
    })
  })

  describe('parseRechargeCallback', () => {
    it('合法 TRADE_SUCCESS 回调应解析成功', () => {
      const params: Record<string, string> = {
        app_id: '2021000000000000',
        out_trade_no: 'T20260801001',
        trade_no: '2026080122000000000000000001',
        trade_status: 'TRADE_SUCCESS',
        total_amount: '100.00',
        seller_id: '2088000000000000',
      }
      params.sign = signNotifyParams(params, keyPair.privateKey)
      const cfg = { appId: '2021000000000000', privateKey: keyPair.privateKey, alipayPublicKey: keyPair.publicKey }

      const result = channel.parseRechargeCallback(buildRawBody(params), {}, cfg)
      expect(result.status).toBe('SUCCESS')
      expect(result.orderNo).toBe('T20260801001')
      expect(result.channelOrderNo).toBe('2026080122000000000000000001')
      expect(result.amount).toBe(10000)
      expect(result.signature).toBe(params.sign)
    })

    it('签名非法时应抛错', () => {
      const params: Record<string, string> = {
        app_id: '2021000000000000',
        out_trade_no: 'T20260801001',
        trade_status: 'TRADE_SUCCESS',
        total_amount: '100.00',
        sign: 'invalid',
      }
      const cfg = { appId: '2021000000000000', privateKey: keyPair.privateKey, alipayPublicKey: keyPair.publicKey }
      expect(() => channel.parseRechargeCallback(buildRawBody(params), {}, cfg)).toThrow(KBErrorCodes.AUTHENTICATION_FAILED)
    })

    it('TRADE_CLOSED 应解析为 FAILED', () => {
      const params: Record<string, string> = {
        out_trade_no: 'T20260801002',
        trade_no: '2026080122000000000000000002',
        trade_status: 'TRADE_CLOSED',
        total_amount: '50.00',
      }
      params.sign = signNotifyParams(params, keyPair.privateKey)
      const cfg = { appId: '2021000000000000', privateKey: keyPair.privateKey, alipayPublicKey: keyPair.publicKey }
      expect(channel.parseRechargeCallback(buildRawBody(params), {}, cfg).status).toBe('FAILED')
    })
  })

  describe('createRecharge', () => {
    it('page 支付应生成包含签名参数的网关 URL', async () => {
      const result = await channel.createRecharge({
        orderNo: 'R20260801001',
        amount: 10000,
        userId: 'U1',
        subject: '充值测试',
        notifyUrl: 'https://example.com/notify',
        channelConfig: {
          appId: '2021000000000000',
          privateKey: keyPair.privateKey,
          alipayPublicKey: keyPair.publicKey,
          notifyUrl: 'https://example.com/notify',
          returnUrl: 'https://example.com/return',
        },
        payMethod: 'page',
      })

      expect(result.status).toBe('PENDING')
      expect(result.channelOrderNo).toBe('R20260801001')
      expect(result.payUrl).toContain('openapi.alipay.com/gateway.do')
      expect(result.payUrl).toContain('method=alipay.trade.page.pay')
      expect(result.payUrl).toContain('app_id=2021000000000000')
      expect(result.payUrl).toContain('sign=')
      expect(result.payUrl).toContain('notify_url=')
      expect(result.payUrl).toContain('biz_content=')
      expect(result.payParams?.pay_url).toBe(result.payUrl)
    })

    it('缺少 appId/privateKey 时应抛错', async () => {
      await expect(
        channel.createRecharge({
          orderNo: 'R20260801002',
          amount: 100,
          userId: 'U1',
          subject: '充值测试',
          notifyUrl: 'https://example.com/notify',
          channelConfig: {},
          payMethod: 'wap',
        }),
      ).rejects.toThrow(KBErrorCodes.RECHARGE_CHANNEL_FAILED)
    })
  })

  describe('queryRefund', () => {
    it('非法 channelRefundNo 格式应返回 FAILED', async () => {
      const cfg = { appId: '2021000000000000', privateKey: keyPair.privateKey }
      const result = await channel.queryRefund('bad-format-no-colon', cfg)
      expect(result.status).toBe('FAILED')
      expect(result.message).toContain('格式非法')
    })
  })
})
