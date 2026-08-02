import { PaymentChannelBridge } from './payment-channel.bridge'
import { PaymentChannelRegistry } from './payment-channel.registry'
import { ConnectorRegistry } from './connector.registry'
import { ConnectorRouter } from './connector-router'

const makeRequest = (overrides: Record<string, unknown> = {}): any => ({
  orderNo: 'O1',
  amount: 100,
  userId: 'u1',
  subject: '测试',
  notifyUrl: 'http://example.com/notify',
  channelConfig: {},
  ...overrides,
})

describe('PaymentChannelBridge', () => {
  let bridge: PaymentChannelBridge
  let channel: {
    createRecharge: jest.Mock
    createPayout: jest.Mock
    refund: jest.Mock
    queryRefund: jest.Mock
    queryPayout: jest.Mock
    queryOrder: jest.Mock
  }
  let channelRegistry: { getChannel: jest.Mock }
  let connectorRegistry: { get: jest.Mock }
  let router: { route: jest.Mock }

  beforeEach(() => {
    channel = {
      createRecharge: jest.fn().mockResolvedValue({ channelOrderNo: 'CR1', status: 'PENDING' }),
      createPayout: jest.fn().mockResolvedValue({ channelOrderNo: 'CP1', status: 'PROCESSING' }),
      refund: jest.fn().mockResolvedValue({ channelRefundNo: 'RF1', status: 'PENDING' }),
      queryRefund: jest.fn().mockResolvedValue({ channelRefundNo: 'RF1', status: 'SUCCESS' }),
      queryPayout: jest.fn().mockResolvedValue({ channelOrderNo: 'CP1', status: 'SUCCESS' }),
      queryOrder: jest.fn().mockResolvedValue({ channelOrderNo: 'CR1', status: 'SUCCESS', totalAmount: 100 }),
    }
    channelRegistry = {
      getChannel: jest.fn().mockReturnValue(channel),
    }
    connectorRegistry = {
      get: jest.fn(),
    }
    router = {
      route: jest.fn().mockResolvedValue({ connectorName: 'mock', result: {}, fallbackChain: [] }),
    }
    bridge = new PaymentChannelBridge(
      channelRegistry as unknown as PaymentChannelRegistry,
      connectorRegistry as unknown as ConnectorRegistry,
      router as unknown as ConnectorRouter,
    )
  })

  describe('连接器未注册时回退直连渠道', () => {
    it('不调用路由器，直接调用渠道方法', async () => {
      connectorRegistry.get.mockReturnValue(undefined)

      const result = await bridge.createRecharge('mock', makeRequest())

      expect(router.route).not.toHaveBeenCalled()
      expect(channel.createRecharge).toHaveBeenCalledWith(makeRequest())
      expect(result).toEqual({ channelOrderNo: 'CR1', status: 'PENDING' })
      expect(channelRegistry.getChannel).toHaveBeenCalledWith('mock')
    })
  })

  describe('连接器已注册时经 ConnectorRouter 路由', () => {
    it('按能力 + 请求 + preferredName 调用路由，返回 result', async () => {
      connectorRegistry.get.mockReturnValue({ metadata: { name: 'mock' } })
      router.route.mockResolvedValue({
        connectorName: 'mock',
        result: { channelOrderNo: 'CR1', status: 'PENDING' },
        fallbackChain: [],
      })

      const req = makeRequest()
      const result = await bridge.createRecharge('mock', req)

      expect(router.route).toHaveBeenCalledWith(
        'RECHARGE',
        req,
        expect.any(Function),
        undefined,
        { preferredName: 'mock' },
      )
      expect(result).toEqual({ channelOrderNo: 'CR1', status: 'PENDING' })
    })

    it('微信渠道编码映射到 wechat_pay 连接器', async () => {
      connectorRegistry.get.mockReturnValue({ metadata: { name: 'wechat_pay' } })
      router.route.mockResolvedValue({ connectorName: 'wechat_pay', result: {}, fallbackChain: [] })

      await bridge.createRecharge('wechat', makeRequest())

      expect(connectorRegistry.get).toHaveBeenCalledWith('wechat_pay')
      expect(router.route).toHaveBeenCalledWith(
        'RECHARGE',
        expect.anything(),
        expect.any(Function),
        undefined,
        { preferredName: 'wechat_pay' },
      )
    })

    it('路由器异常向上传播', async () => {
      connectorRegistry.get.mockReturnValue({ metadata: { name: 'mock' } })
      router.route.mockRejectedValue(new Error('All connectors failed'))

      await expect(bridge.createRecharge('mock', makeRequest())).rejects.toThrow(
        'All connectors failed',
      )
    })
  })

  describe('各外呼方法路由到正确能力与渠道方法', () => {
    it('createPayout → PAYOUT + channel.createPayout', async () => {
      connectorRegistry.get.mockReturnValue({ metadata: { name: 'mock' } })
      const req = makeRequest()
      await bridge.createPayout('mock', req)
      expect(router.route).toHaveBeenCalledWith('PAYOUT', req, expect.any(Function), undefined, { preferredName: 'mock' })
      expect(channel.createPayout).not.toHaveBeenCalled() // 由路由结果返回，不直接调渠道
    })

    it('refund → REFUND + channel.refund', async () => {
      connectorRegistry.get.mockReturnValue({ metadata: { name: 'mock' } })
      const req = makeRequest()
      await bridge.refund('mock', req)
      expect(router.route).toHaveBeenCalledWith('REFUND', req, expect.any(Function), undefined, { preferredName: 'mock' })
    })

    it('queryRefund → REFUND + 透传 channelConfig', async () => {
      connectorRegistry.get.mockReturnValue(undefined)
      await bridge.queryRefund('mock', 'RF1', { appId: 'a' })
      expect(channel.queryRefund).toHaveBeenCalledWith('RF1', { appId: 'a' })
    })

    it('queryPayout → PAYOUT + 透传 channelConfig', async () => {
      connectorRegistry.get.mockReturnValue(undefined)
      await bridge.queryPayout('mock', 'CP1', { mchid: 'm' })
      expect(channel.queryPayout).toHaveBeenCalledWith('CP1', { mchid: 'm' })
    })

    it('queryOrder → RECHARGE + 透传 channelConfig', async () => {
      connectorRegistry.get.mockReturnValue(undefined)
      await bridge.queryOrder('mock', 'CR1', { appId: 'a' })
      expect(channel.queryOrder).toHaveBeenCalledWith('CR1', { appId: 'a' })
    })
  })

  describe('回退直连时请求体与渠道方法正确转发', () => {
    it('回退直连时按渠道编码取渠道实例并调用对应方法', async () => {
      connectorRegistry.get.mockReturnValue(undefined)

      const refundReq = makeRequest({ refundNo: 'RF1', channelOrderNo: 'CR1' })
      await bridge.refund('mock', refundReq)
      expect(channel.refund).toHaveBeenCalledWith(refundReq)

      const payoutReq = makeRequest({ channelAccount: '6222', userName: '张三' })
      await bridge.createPayout('mock', payoutReq)
      expect(channel.createPayout).toHaveBeenCalledWith(payoutReq)
    })
  })
})
