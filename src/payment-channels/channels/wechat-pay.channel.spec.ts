// ============================================================================
// WechatPayChannel 单元测试（覆盖无网络路径：回调解密/验签/响应构建）
// ============================================================================

import { WechatPayChannel } from './wechat-pay.channel'
import { createCipheriv, generateKeyPairSync, createSign, randomBytes } from 'crypto'
import { KBErrorCodes } from '../../common/error-codes'

const API_V3_KEY = '0123456789abcdef0123456789abcdef' // 32 字符

/** 按微信 V3 规范对回调 resource 做 AEAD_AES_256_GCM 加密 */
function encryptResource(resource: object, nonce: string, associatedData: string): string {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(API_V3_KEY, 'utf-8'), Buffer.from(nonce, 'utf-8'))
  cipher.setAAD(Buffer.from(associatedData, 'utf-8'))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(resource), 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([encrypted, authTag]).toString('base64')
}

function buildNotifyBody(resource: object): string {
  const nonce = 'abcdefghijkl' // 12 字符
  const associatedData = 'transaction'
  const ciphertext = encryptResource(resource, nonce, associatedData)
  return JSON.stringify({
    id: 'notif-id-001',
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: {
      ciphertext,
      nonce,
      associated_data: associatedData,
      algorithm: 'AEAD_AES_256_GCM',
    },
  })
}

describe('WechatPayChannel', () => {
  let channel: WechatPayChannel

  beforeEach(() => {
    channel = new WechatPayChannel()
  })

  describe('parseRechargeCallback', () => {
    it('未配置 apiV3Key 时抛错', () => {
      expect(() => channel.parseRechargeCallback('{}', {}, {})).toThrow(KBErrorCodes.AUTHENTICATION_FAILED)
    })

    it('SUCCESS 交易回调应正确解密并解析', () => {
      const rawBody = buildNotifyBody({
        out_trade_no: 'T20260801001',
        transaction_id: '4200001001202608010001',
        trade_state: 'SUCCESS',
        amount: { total: 100, currency: 'CNY', payer_total: 100, payer_currency: 'CNY' },
        success_time: '2026-08-01T10:00:00+08:00',
      })

      const result = channel.parseRechargeCallback(
        rawBody,
        { 'wechatpay-signature': 'sig' },
        { apiV3Key: API_V3_KEY },
      )

      expect(result.status).toBe('SUCCESS')
      expect(result.orderNo).toBe('T20260801001')
      expect(result.channelOrderNo).toBe('4200001001202608010001')
      expect(result.amount).toBe(100)
      expect(result.signature).toBe('sig')
    })

    it('非 SUCCESS 交易状态应解析为 FAILED', () => {
      const rawBody = buildNotifyBody({
        out_trade_no: 'T20260801002',
        transaction_id: '4200001001202608010002',
        trade_state: 'NOTPAY',
        amount: { total: 100, currency: 'CNY' },
      })

      const result = channel.parseRechargeCallback(rawBody, {}, { apiV3Key: API_V3_KEY })
      expect(result.status).toBe('FAILED')
    })

    it('body 非 JSON 时抛错', () => {
      expect(() => channel.parseRechargeCallback('not-json', {}, { apiV3Key: API_V3_KEY })).toThrow(
        KBErrorCodes.AUTHENTICATION_FAILED,
      )
    })

    it('非法密文应解密失败并抛错', () => {
      const rawBody = JSON.stringify({
        resource: {
          ciphertext: randomBytes(32).toString('base64'),
          nonce: 'abcdefghijkl',
          associated_data: 'transaction',
        },
      })
      expect(() => channel.parseRechargeCallback(rawBody, {}, { apiV3Key: API_V3_KEY })).toThrow(
        KBErrorCodes.AUTHENTICATION_FAILED,
      )
    })
  })

  describe('parsePayoutCallback', () => {
    it('FINISHED 且 success_num 达标应判定 SUCCESS', () => {
      const rawBody = buildNotifyBody({
        batch_id: '10300000711009999911820260101',
        out_batch_no: 'W20260801001',
        batch_status: 'FINISHED',
        total_num: 1,
        success_num: 1,
      })

      const result = channel.parsePayoutCallback(rawBody, {}, { apiV3Key: API_V3_KEY })
      expect(result.status).toBe('SUCCESS')
      expect(result.orderNo).toBe('W20260801001')
      expect(result.channelOrderNo).toBe('10300000711009999911820260101')
    })

    it('FINISHED 但 success_num 不达标应判定 FAILED（防资金事故）', () => {
      const rawBody = buildNotifyBody({
        batch_id: '10300000711009999911820260102',
        out_batch_no: 'W20260801002',
        batch_status: 'FINISHED',
        total_num: 1,
        success_num: 0,
      })

      const result = channel.parsePayoutCallback(rawBody, {}, { apiV3Key: API_V3_KEY })
      expect(result.status).toBe('FAILED')
    })

    it('批次处理中应判定 FAILED', () => {
      const rawBody = buildNotifyBody({
        batch_id: '10300000711009999911820260103',
        out_batch_no: 'W20260801003',
        batch_status: 'PROCESSING',
      })

      const result = channel.parsePayoutCallback(rawBody, {}, { apiV3Key: API_V3_KEY })
      expect(result.status).toBe('FAILED')
    })
  })

  describe('parseRefundCallback', () => {
    it('SUCCESS 退款回调应正确解密并解析', () => {
      const rawBody = buildNotifyBody({
        out_trade_no: 'T20260801001',
        out_refund_no: 'RF20260801001',
        refund_id: '5000000934202608010001',
        refund_status: 'SUCCESS',
        amount: { total: 100, refund: 100, payer_total: 100, payer_refund: 100 },
      })

      const result = channel.parseRefundCallback(rawBody, {}, { apiV3Key: API_V3_KEY })
      expect(result.status).toBe('SUCCESS')
      expect(result.orderNo).toBe('T20260801001')
      expect(result.refundNo).toBe('RF20260801001')
      expect(result.channelRefundNo).toBe('5000000934202608010001')
      expect(result.amount).toBe(100)
    })
  })

  describe('verifyWebhookSignature', () => {
    it('合法签名应验证通过，非法签名应失败', () => {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      const rawBody = JSON.stringify({ event: 'test' })
      const timestamp = String(Math.floor(Date.now() / 1000))
      const nonce = 'abcdefghijkl'
      const message = `${timestamp}\n${nonce}\n${rawBody}\n`
      const signature = createSign('RSA-SHA256').update(message).sign(privateKey, 'base64')

      const validHeaders = {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': signature,
        'wechatpay-serial': 'SERIAL_NO_001',
      }

      expect(channel.verifyWebhookSignature(rawBody, validHeaders, { platformCert: publicKey })).toBe(true)
      expect(
        channel.verifyWebhookSignature(rawBody, { ...validHeaders, 'wechatpay-signature': 'tampered' }, { platformCert: publicKey }),
      ).toBe(false)
      expect(channel.verifyWebhookSignature(rawBody, validHeaders, {})).toBe(false)
    })
  })

  describe('callback success responses', () => {
    it('应返回微信约定的 SUCCESS 响应', () => {
      expect(channel.buildRechargeCallbackSuccess()).toBe(JSON.stringify({ code: 'SUCCESS', message: '成功' }))
      expect(channel.buildRefundCallbackSuccess()).toBe(JSON.stringify({ code: 'SUCCESS', message: '成功' }))
      expect(channel.buildPayoutCallbackSuccess()).toBe(JSON.stringify({ code: 'SUCCESS', message: '成功' }))
    })
  })
})
