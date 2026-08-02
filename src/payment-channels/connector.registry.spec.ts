import { ConnectorRegistry } from './connector.registry'
import { Connector, ConnectorCapability, ConnectorConfig, ConnectorMetadata, ConnectorHealth } from './connector.interface'

// ============================================================
// Mock 连接器（用于测试）
// ============================================================
class MockTestConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'test_connector',
    displayName: 'Test Connector',
    capabilities: ['RECHARGE', 'PAYOUT'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'test_connector',
    displayName: 'Test Connector',
    capabilities: ['RECHARGE', 'PAYOUT'],
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

class MockConnectorA implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'connector_a',
    displayName: 'Connector A',
    capabilities: ['RECHARGE'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'connector_a',
    displayName: 'Connector A',
    capabilities: ['RECHARGE'],
    priority: 10,
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

class MockConnectorB implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'connector_b',
    displayName: 'Connector B',
    capabilities: ['RECHARGE'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['native'],
    version: '1.0.0',
  }
  private config: ConnectorConfig = {
    name: 'connector_b',
    displayName: 'Connector B',
    capabilities: ['RECHARGE'],
    priority: 20,
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
describe('ConnectorRegistry', () => {
  let registry: ConnectorRegistry
  let connector: MockTestConnector

  beforeEach(() => {
    registry = new ConnectorRegistry()
    connector = new MockTestConnector()
  })

  describe('register / unregister', () => {
    it('注册后可通过 get 获取', () => {
      registry.register(connector)
      expect(registry.get('test_connector')).toBe(connector)
    })

    it('注册后返回数量正确', () => {
      registry.register(connector)
      expect(registry.getRegisteredCount()).toBe(1)
    })

    it('注销后返回 false 且不可获取', () => {
      registry.register(connector)
      expect(registry.unregister('test_connector')).toBe(true)
      expect(registry.get('test_connector')).toBeUndefined()
      expect(registry.getRegisteredCount()).toBe(0)
    })

    it('注销不存在的连接器返回 false', () => {
      expect(registry.unregister('nonexistent')).toBe(false)
    })

    it('重复注册会覆盖', () => {
      const c2 = new MockTestConnector()
      // 通过不同引用来验证覆盖（readonly 不可改，但不同实例 metadata 不同）
      registry.register(connector)
      registry.register(c2)
      expect(registry.get('test_connector')).toBe(c2)
      expect(registry.getRegisteredCount()).toBe(1)
    })
  })

  describe('getByCapability', () => {
    it('按能力获取连接器', () => {
      registry.register(connector)
      const results = registry.getByCapability('RECHARGE')
      expect(results).toHaveLength(1)
      expect(results[0].metadata.name).toBe('test_connector')
    })

    it('不匹配能力返回空列表', () => {
      registry.register(connector)
      expect(registry.getByCapability('RECONCILIATION')).toHaveLength(0)
    })

    it('返回按优先级降序排列的结果', () => {
      const a = new MockConnectorA() // priority 10
      const b = new MockConnectorB() // priority 20
      registry.register(a)
      registry.register(b)

      const results = registry.getByCapability('RECHARGE')
      expect(results).toHaveLength(2)
      expect(results[0].metadata.name).toBe('connector_b') // 高优先级在前
      expect(results[1].metadata.name).toBe('connector_a')
    })
  })

  describe('getPrimaryByCapability / getFallback', () => {
    it('返回最高优先级的连接器', () => {
      const a = new MockConnectorA()
      const b = new MockConnectorB()
      registry.register(a)
      registry.register(b)

      expect(registry.getPrimaryByCapability('RECHARGE')?.metadata.name).toBe('connector_b')
    })

    it('无匹配时返回 undefined', () => {
      expect(registry.getPrimaryByCapability('REFUND')).toBeUndefined()
    })

    it('排除指定连接器返回次优先级的', () => {
      const a = new MockConnectorA()
      const b = new MockConnectorB()
      registry.register(a)
      registry.register(b)

      const fallback = registry.getFallback('RECHARGE', 'connector_b')
      expect(fallback?.metadata.name).toBe('connector_a')
    })
  })

  describe('getAll', () => {
    it('返回所有注册连接器的副本', () => {
      registry.register(new MockConnectorA())
      registry.register(new MockConnectorB())
      expect(registry.getAll()).toHaveLength(2)
    })
  })

  describe('syncConfig', () => {
    it('同步配置并重建优先级索引', () => {
      const a = new MockConnectorA() // priority 10
      const b = new MockConnectorB() // priority 20
      registry.register(a)
      registry.register(b)
      // 把 b 优先级降到 5，A 应变为最高优先级
      expect(registry.syncConfig('connector_b', { priority: 5 })).toBe(true)
      expect(registry.getPrimaryByCapability('RECHARGE')?.metadata.name).toBe('connector_a')
      expect(b.getConfig().priority).toBe(5)
    })

    it('同步不存在的连接器返回 false', () => {
      expect(registry.syncConfig('missing', { priority: 1 })).toBe(false)
    })
  })

  describe('getCapabilityIndex', () => {
    it('返回能力索引', () => {
      const a = new MockConnectorA()
      const b = new MockConnectorB()
      registry.register(a)
      registry.register(b)

      const index = registry.getCapabilityIndex()
      expect(index.has('RECHARGE')).toBe(true)
      expect(index.get('RECHARGE')!.sort()).toEqual(['connector_a', 'connector_b'].sort())
    })

    it('注销后重建索引', () => {
      const a = new MockConnectorA()
      const b = new MockConnectorB()
      registry.register(a)
      registry.register(b)
      registry.unregister('connector_a')

      const index = registry.getCapabilityIndex()
      expect(index.get('RECHARGE')).toEqual(['connector_b'])
    })
  })
})
