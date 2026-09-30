// ============================================================================
// MockChannel 单元测试（覆盖三类回调的签名验证与解析）
// ============================================================================

import { beforeEach, afterEach, describe, expect, it } from '@jest/globals'
import { MockChannel } from './mock.channel.js'
import { createHmac } from 'crypto'

const MOCK_SECRET = 'mock-channel-secret-dev-only'

function sign(str: string): string {
  return createHmac('sha256', MOCK_SECRET).update(str).digest('hex')
}

describe('MockChannel', () => {
  let channel: MockChannel

  beforeEach(() => {
    delete process.env.MOCK_CHANNEL_SECRET
    channel = new MockChannel()
  })

  afterEach(() => {
    delete process.env.MOCK_CHANNEL_SECRET
  })

  describe('verifyWebhookSignature', () => {
    it('充值回调使用 orderNo+channelOrderNo+amount 验签', () => {
      const body = { orderNo: 'R1', channelOrderNo: 'MOCK_R_R1', amount: '8888' }
      const raw = JSON.stringify(body)
      const ok = channel.verifyWebhookSignature(raw, { 'x-signature': sign('R1MOCK_R_R18888') }, {} as never)
      expect(ok).toBe(true)
      const bad = channel.verifyWebhookSignature(raw, { 'x-signature': sign('R1MOCK_R_R19999') }, {} as never)
      expect(bad).toBe(false)
    })

    it('退款回调使用 orderNo+refundNo+amount 验签', () => {
      const body = { orderNo: 'R1', refundNo: 'RF1', channelRefundNo: 'MOCK_RF_RF1', amount: '8888' }
      const raw = JSON.stringify(body)
      const ok = channel.verifyWebhookSignature(raw, { 'x-signature': sign('R1RF18888') }, {} as never)
      expect(ok).toBe(true)
      const bad = channel.verifyWebhookSignature(raw, { 'x-signature': sign('R1RF19999') }, {} as never)
      expect(bad).toBe(false)
    })

    it('非 JSON body 返回 false', () => {
      expect(channel.verifyWebhookSignature('not-json', { 'x-signature': 'x' }, {} as never)).toBe(false)
    })
  })

  describe('parseRefundCallback', () => {
    it('退款回调解析成功并校验签名', () => {
      const body = { orderNo: 'R1', refundNo: 'RF1', channelRefundNo: 'MOCK_RF_RF1', amount: '8888', status: 'SUCCESS' }
      const raw = JSON.stringify(body)
      const result = channel.parseRefundCallback(
        raw,
        { 'x-signature': sign('R1RF18888') },
        {} as never,
      )
      expect(result.status).toBe('SUCCESS')
      expect(result.refundNo).toBe('RF1')
    })

    it('签名错误时抛出认证异常', () => {
      const body = { orderNo: 'R1', refundNo: 'RF1', channelRefundNo: 'MOCK_RF_RF1', amount: '8888', status: 'SUCCESS' }
      expect(() =>
        channel.parseRefundCallback(
          JSON.stringify(body),
          { 'x-signature': sign('R1RF19999') },
          {} as never,
        ),
      ).toThrow(/签名/)
    })
  })
})
