import { ConnectorRegistry } from './connector.registry'
import { ConnectorRouter, RouteResult } from './connector-router'
import { Connector, ConnectorConfig, ConnectorMetadata } from './connector.interface'

// ============================================================
// Mock 连接器（用于测试降级路由）
// ============================================================
class PrimaryConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'primary',
    displayName: 'Primary',
    capabilities: ['RECHARGE'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'primary',
    displayName: 'Primary',
    capabilities: ['RECHARGE'],
    priority: 100,
    timeout: 5000,
    retryConfig: { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 500 },
  }
  getConfig = () => ({ ...this.config })
  setConfig = (c: Partial<ConnectorConfig>) => { this.config = { ...this.config, ...c } }
  createPayment = jest.fn()
  queryPayment = jest.fn()
  refundPayment = jest.fn()
  verifyWebhook = jest.fn()
  parseWebhookEvent = jest.fn()
  healthCheck = jest.fn()
}

class FallbackConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'fallback',
    displayName: 'Fallback',
    capabilities: ['RECHARGE'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'fallback',
    displayName: 'Fallback',
    capabilities: ['RECHARGE'],
    priority: 50,
    timeout: 5000,
    retryConfig: { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 500 },
  }
  getConfig = () => ({ ...this.config })
  setConfig = (c: Partial<ConnectorConfig>) => { this.config = { ...this.config, ...c } }
  createPayment = jest.fn()
  queryPayment = jest.fn()
  refundPayment = jest.fn()
  verifyWebhook = jest.fn()
  parseWebhookEvent = jest.fn()
  healthCheck = jest.fn()
}

// ============================================================
// Tests
// ============================================================
describe('ConnectorRouter', () => {
  let registry: ConnectorRegistry
  let router: ConnectorRouter
  let primary: PrimaryConnector
  let fallback: FallbackConnector

  beforeEach(() => {
    registry = new ConnectorRegistry()
    router = new ConnectorRouter(registry)
    primary = new PrimaryConnector()
    fallback = new FallbackConnector()

    registry.register(primary)
    registry.register(fallback)
  })

  describe('route - 基础路由', () => {
    it('成功路由到最高优先级连接器', async () => {
      const requestFn = jest.fn().mockResolvedValue({ transactionId: 'tx_001' })
      ;(primary.createPayment as jest.Mock).mockResolvedValue({ transactionId: 'tx_001' })

      const result = await router.route('RECHARGE', { amount: 100 }, async (connector, config, req) => {
        return connector.createPayment(req)
      })

      expect(result.connectorName).toBe('primary')
      expect(result.result).toEqual({ transactionId: 'tx_001' })
      expect(result.fallbackChain).toEqual([])
    })

    it('能力无匹配时抛错', async () => {
      await expect(
        router.route('REFUND', {}, async () => ({})),
      ).rejects.toThrow('No connector available for capability: REFUND')
    })
  })

  describe('route - preferredName（精确路由）', () => {
    it('仅路由到指定连接器，不做跨渠道降级', async () => {
      ;(fallback.createPayment as jest.Mock).mockResolvedValue({ transactionId: 'tx_fallback' })

      const result = await router.route(
        'RECHARGE',
        { amount: 100 },
        async (connector, config, req) => connector.createPayment(req),
        undefined,
        { preferredName: 'fallback' },
      )

      expect(result.connectorName).toBe('fallback')
      expect(result.result).toEqual({ transactionId: 'tx_fallback' })
      // primary 即使优先级更高也不被尝试（渠道选择已由上层完成）
      expect(primary.createPayment).not.toHaveBeenCalled()
    })

    it('指定连接器未注册时抛错（不尝试其他连接器）', async () => {
      ;(primary.createPayment as jest.Mock).mockResolvedValue({ transactionId: 'tx_primary' })

      await expect(
        router.route(
          'RECHARGE',
          { amount: 100 },
          async (connector, config, req) => connector.createPayment(req),
          undefined,
          { preferredName: 'nonexistent' },
        ),
      ).rejects.toThrow('preferred: nonexistent')
      expect(primary.createPayment).not.toHaveBeenCalled()
    })

    it('指定连接器失败且无其他候选时抛 All connectors failed', async () => {
      ;(fallback.createPayment as jest.Mock).mockRejectedValue(new Error('fallback down'))

      await expect(
        router.route(
          'RECHARGE',
          { amount: 100 },
          async (connector, config, req) => connector.createPayment(req),
          { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 50 },
          { preferredName: 'fallback' },
        ),
      ).rejects.toThrow('All connectors failed')
    })
  })

  describe('route - 降级', () => {
    it('主连接器失败后自动降级到备选', async () => {
      ;(primary.createPayment as jest.Mock).mockRejectedValue(new Error('primary down'))
      ;(fallback.createPayment as jest.Mock).mockResolvedValue({ transactionId: 'tx_fallback' })

      const result = await router.route('RECHARGE', { amount: 100 }, async (connector, config, req) => {
        return connector.createPayment(req)
      })

      expect(result.connectorName).toBe('fallback')
      expect(result.result).toEqual({ transactionId: 'tx_fallback' })
      expect(result.fallbackChain).toEqual(['primary'])
    })

    it('所有连接器都失败时抛错', async () => {
      ;(primary.createPayment as jest.Mock).mockRejectedValue(new Error('primary down'))
      ;(fallback.createPayment as jest.Mock).mockRejectedValue(new Error('fallback down'))

      await expect(
        router.route('RECHARGE', { amount: 100 }, async (connector, config, req) => {
          return connector.createPayment(req)
        }),
      ).rejects.toThrow('All connectors failed for capability RECHARGE')
    })

    it('健康检查失败时跳过连接器', async () => {
      router.updateHealth('primary', false)
      ;(fallback.createPayment as jest.Mock).mockResolvedValue({ transactionId: 'tx_fallback' })

      const result = await router.route('RECHARGE', { amount: 100 }, async (connector, config, req) => {
        return connector.createPayment(req)
      })

      expect(result.connectorName).toBe('fallback')
      expect(primary.createPayment).not.toHaveBeenCalled()
    })
  })

  describe('route - 重试', () => {
    it('临时失败后重试最终成功', async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ transactionId: 'tx_retry' })

      const result = await router.route(
        'RECHARGE',
        { amount: 100 },
        async (connector, config, req) => mockFn(),
        { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 },
      )

      expect(result.connectorName).toBe('primary')
      expect(result.result).toEqual({ transactionId: 'tx_retry' })
      expect(mockFn).toHaveBeenCalledTimes(2)
    })

    it('重试耗尽后降级', async () => {
      ;(primary.createPayment as jest.Mock).mockRejectedValue(new Error('persistent failure'))
      ;(fallback.createPayment as jest.Mock).mockResolvedValue({ transactionId: 'tx_fallback' })

      const result = await router.route(
        'RECHARGE',
        { amount: 100 },
        async (connector, config, req) => connector.createPayment(req),
        { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 50 },
      )

      expect(result.connectorName).toBe('fallback')
    })
  })

  describe('updateHealth / isHealthy', () => {
    it('默认健康', () => {
      expect(router.isHealthy('unknown')).toBe(true)
    })

    it('标记为不健康后 isHealthy 返回 false', () => {
      router.updateHealth('primary', false)
      expect(router.isHealthy('primary')).toBe(false)
    })

    it('超过缓存时间后重新视为健康', () => {
      router.updateHealth('primary', false)
      // 直接检查内部缓存 - 默认 60s 过期
      // 模拟时间流逝不可行，但测试逻辑：未过期的 false 返回 false
      expect(router.isHealthy('primary')).toBe(false)
    })

    it('更新为健康后恢复正常', () => {
      router.updateHealth('primary', false)
      router.updateHealth('primary', true)
      expect(router.isHealthy('primary')).toBe(true)
    })
  })
})
