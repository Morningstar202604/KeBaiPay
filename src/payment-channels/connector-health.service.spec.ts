import { ConnectorRegistry } from './connector.registry'
import { ConnectorRouter } from './connector-router'
import { ConnectorHealthService } from './connector-health.service'
import { Connector, ConnectorConfig, ConnectorMetadata, ConnectorHealth } from './connector.interface'

// ============================================================
// Mock Connector for health check testing
// ============================================================
class HealthyConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'healthy',
    displayName: 'Healthy',
    capabilities: ['RECHARGE'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'healthy',
    displayName: 'Healthy',
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
  healthCheck = jest.fn().mockResolvedValue({
    status: 'ACTIVE',
    lastChecked: new Date(),
    latency: 42,
    errorRate: 0,
  } as ConnectorHealth)
}

class DegradedConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'degraded',
    displayName: 'Degraded',
    capabilities: ['PAYOUT'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'degraded',
    displayName: 'Degraded',
    capabilities: ['PAYOUT'],
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
  healthCheck = jest.fn().mockRejectedValue(new Error('Service unreachable'))
}

class TimeoutConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'timeout',
    displayName: 'Timeout',
    capabilities: ['REFUND'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'timeout',
    displayName: 'Timeout',
    capabilities: ['REFUND'],
    priority: 30,
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
  healthCheck = jest.fn().mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 200)))
}

describe('ConnectorHealthService', () => {
  let registry: ConnectorRegistry
  let router: ConnectorRouter
  let healthService: ConnectorHealthService
  let healthy: HealthyConnector
  let degraded: DegradedConnector

  beforeEach(() => {
    registry = new ConnectorRegistry()
    router = new ConnectorRouter(registry)
    healthService = new ConnectorHealthService(registry, router)
    healthy = new HealthyConnector()
    degraded = new DegradedConnector()
  })

  describe('checkConnector', () => {
    it('健康连接器返回 ACTIVE 状态', async () => {
      registry.register(healthy)
      const result = await healthService.checkConnector('healthy')
      expect(result.status).toBe('ACTIVE')
      expect(result.errorRate).toBe(0)
    })

    it('异常连接器返回 DEGRADED', async () => {
      registry.register(degraded)
      const result = await healthService.checkConnector('degraded')
      expect(result.status).toBe('DEGRADED')
      expect(result.errorRate).toBe(1)
      expect(result.errorMessage).toBeDefined()
    })

    it('不存在的连接器抛错', async () => {
      await expect(healthService.checkConnector('unknown')).rejects.toThrow('Connector not found: unknown')
    })

    it('超时连接器返回 DEGRADED', async () => {
      const timeout = new TimeoutConnector()
      registry.register(timeout)
      const result = await healthService.checkConnector('timeout')
      expect(result.status).toBe('DEGRADED')
      expect(result.errorMessage).toContain('timeout')
    })
  })

  describe('getHealth / getAllHealth', () => {
    it('获取已检查连接器的健康记录', async () => {
      registry.register(healthy)
      await healthService.checkConnector('healthy')
      const record = healthService.getHealth('healthy')
      expect(record).toBeDefined()
      expect(record!.healthy).toBe(true)
      expect(record!.consecutiveFailures).toBe(0)
    })

    it('未检查的连接器返回 undefined', () => {
      expect(healthService.getHealth('unknown')).toBeUndefined()
    })
  })

  describe('连续失败阈值', () => {
    it('连续失败 3 次后标记为 degraded', async () => {
      registry.register(degraded)

      for (let i = 0; i < 3; i++) {
        await healthService.checkConnector('degraded')
      }

      const record = healthService.getHealth('degraded')
      expect(record).toBeDefined()
      expect(record!.consecutiveFailures).toBe(3)
      expect(record!.healthy).toBe(false)
    })
  })

  describe('恢复检测', () => {
    it('失败后恢复健康时更新记录', async () => {
      registry.register(healthy)

      // 先失败两次
      ;(healthy.healthCheck as jest.Mock).mockRejectedValue(new Error('down'))
      for (let i = 0; i < 2; i++) {
        await healthService.checkConnector('healthy')
      }

      // 然后恢复
      ;(healthy.healthCheck as jest.Mock).mockResolvedValue({
        status: 'ACTIVE',
        lastChecked: new Date(),
        latency: 30,
        errorRate: 0,
      } as ConnectorHealth)
      await healthService.checkConnector('healthy')

      const record = healthService.getHealth('healthy')
      expect(record!.healthy).toBe(true)
      expect(record!.consecutiveFailures).toBe(0)
    })
  })

  describe('getHealthSummary', () => {
    it('无注册连接器时返回全零', () => {
      const summary = healthService.getHealthSummary()
      expect(summary).toEqual({ total: 0, active: 0, degraded: 0, inactive: 0 })
    })

    it('健康连接器计入 active', async () => {
      registry.register(healthy)
      await healthService.checkConnector('healthy')
      const summary = healthService.getHealthSummary()
      expect(summary.total).toBe(1)
      expect(summary.active).toBe(1)
    })

    it('3次失败后计入 degraded', async () => {
      registry.register(degraded)
      for (let i = 0; i < 3; i++) {
        await healthService.checkConnector('degraded')
      }
      const summary = healthService.getHealthSummary()
      expect(summary.total).toBe(1)
      expect(summary.degraded).toBe(1)
    })
  })
})
