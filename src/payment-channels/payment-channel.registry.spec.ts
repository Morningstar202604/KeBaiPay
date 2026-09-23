import { beforeEach, describe, expect, it, test, jest } from '@jest/globals'
import { PrismaService } from '../prisma/prisma.service.js'
import { CryptoService } from '../crypto/crypto.service.js'
import { PaymentChannelRegistry } from './payment-channel.registry.js'
import { MockChannel } from './channels/mock.channel.js'
import { WechatPayChannel } from './channels/wechat-pay.channel.js'
import { AlipayChannel } from './channels/alipay.channel.js'

// 真实 CryptoService（固定测试密钥），验证库内密文 → 业务读取明文的完整链路
const crypto = new CryptoService({
  get: () => 'unit-test-encryption-key-0123456789abcdef',
} as never)
crypto.onModuleInit()

// 测试夹具哑值：非任何环境的真实凭据
const FIXTURE_APP_ID = '2021003188612345'
const FIXTURE_SEC = 'dummy-registry-test-value'
const FIXTURE_LEGACY = 'dummy-legacy-plain-value'

const configServiceMock = {
  get: (key: string) => (key === 'NODE_ENV' ? 'development' : undefined),
}

type RegistryPrismaMock = {
  paymentChannelConfig: Record<'findUnique' | 'findMany', jest.Mock>
}

describe('PaymentChannelRegistry 配置解密（H1 安全修复）', () => {
  let registry: PaymentChannelRegistry
  let prisma: RegistryPrismaMock

  beforeEach(() => {
    prisma = {
      paymentChannelConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    }
    registry = new PaymentChannelRegistry(
      prisma as unknown as PrismaService,
      configServiceMock as never,
      crypto,
      new MockChannel(),
      new WechatPayChannel(),
      new AlipayChannel(),
    )
  })

  describe('渠道配置进程内 60s TTL 缓存（P0-17 性能优化）', () => {
    it('getEnabledConfig TTL 内命中缓存不查 DB', async () => {
      prisma.paymentChannelConfig.findUnique.mockResolvedValue({
        code: 'alipay',
        name: '支付宝',
        type: 'BOTH',
        enabled: true,
        priority: 10,
        config: JSON.stringify(crypto.encryptConfigValues({ appId: FIXTURE_APP_ID })),
      })

      await registry.getEnabledConfig('alipay')
      await registry.getEnabledConfig('alipay')
      // 第二次调用命中缓存，findUnique 只调 1 次
      expect(prisma.paymentChannelConfig.findUnique).toHaveBeenCalledTimes(1)
    })

    it('getChannelByType TTL 内命中缓存不查 DB', async () => {
      prisma.paymentChannelConfig.findMany.mockResolvedValue([
        {
          code: 'wechat',
          name: '微信支付',
          type: 'RECHARGE',
          enabled: true,
          priority: 20,
          config: JSON.stringify(crypto.encryptConfigValues({ appId: 'wx-app-id' })),
        },
      ])

      await registry.getChannelByType('RECHARGE')
      await registry.getChannelByType('RECHARGE')
      // 第二次调用命中缓存，findMany 只调 1 次
      expect(prisma.paymentChannelConfig.findMany).toHaveBeenCalledTimes(1)
    })

    it('clearChannelConfigCache 后重新查 DB', async () => {
      prisma.paymentChannelConfig.findUnique.mockResolvedValue({
        code: 'mock',
        name: '模拟渠道',
        type: 'BOTH',
        enabled: true,
        priority: 1,
        config: JSON.stringify({ secretKey: FIXTURE_LEGACY }),
      })

      await registry.getEnabledConfig('mock')
      expect(prisma.paymentChannelConfig.findUnique).toHaveBeenCalledTimes(1)

      registry.clearChannelConfigCache()
      await registry.getEnabledConfig('mock')
      // 清缓存后重新查 DB
      expect(prisma.paymentChannelConfig.findUnique).toHaveBeenCalledTimes(2)
    })

    it('NotFoundException（未启用渠道）不被缓存', async () => {
      prisma.paymentChannelConfig.findUnique.mockResolvedValue(null)

      // 两次调用均未命中缓存，每次都查 DB
      await expect(registry.getEnabledConfig('alipay')).rejects.toThrow('支付渠道未启用')
      await expect(registry.getEnabledConfig('alipay')).rejects.toThrow('支付渠道未启用')
      // 未启用渠道不缓存：findUnique 调 2 次（若被缓存则第 2 次应命中）
      expect(prisma.paymentChannelConfig.findUnique).toHaveBeenCalledTimes(2)
    })

    it('clearChannelConfigCache 清 after TTL 过期内不命中缓存', async () => {
      prisma.paymentChannelConfig.findUnique.mockResolvedValue({
        code: 'alipay',
        name: '支付宝',
        type: 'BOTH',
        enabled: true,
        priority: 10,
        config: JSON.stringify(crypto.encryptConfigValues({ appId: FIXTURE_APP_ID })),
      })

      await registry.getEnabledConfig('alipay')
      // 模拟 60s 后 TTL 过期：手动把 expiry 设到过去
      const cache = (
        registry as unknown as { enabledConfigCache: Map<string, { value: unknown; expiry: number }> }
      ).enabledConfigCache
      const entry = cache.get('config:alipay')
      if (entry) entry.expiry = Date.now() - 1

      await registry.getEnabledConfig('alipay')
      // TTL 过期后重新查 DB
      expect(prisma.paymentChannelConfig.findUnique).toHaveBeenCalledTimes(2)
    })
  })

  describe('getEnabledConfig', () => {
    it('返回解密后的渠道配置', async () => {
      const plaintext = { appId: FIXTURE_APP_ID, privateKey: FIXTURE_SEC }
      const encryptedJson = JSON.stringify(crypto.encryptConfigValues(plaintext))
      // 库内必须已是密文：前置校验，防止测试数据本身写错
      expect(encryptedJson).not.toContain(FIXTURE_SEC)

      prisma.paymentChannelConfig.findUnique.mockResolvedValue({
        code: 'alipay',
        name: '支付宝',
        type: 'BOTH',
        enabled: true,
        priority: 10,
        config: encryptedJson,
      })

      const result = await registry.getEnabledConfig('alipay')
      expect(result.config).toEqual(plaintext)
    })

    it('历史明文存量配置兼容读取（无 enc:v1: 前缀原样透传）', async () => {
      prisma.paymentChannelConfig.findUnique.mockResolvedValue({
        code: 'mock',
        name: '模拟渠道',
        type: 'BOTH',
        enabled: true,
        priority: 1,
        config: JSON.stringify({ secretKey: FIXTURE_LEGACY }),
      })

      const result = await registry.getEnabledConfig('mock')
      expect(result.config).toEqual({ secretKey: FIXTURE_LEGACY })
    })

    it('未启用渠道抛 NotFoundException', async () => {
      prisma.paymentChannelConfig.findUnique.mockResolvedValue(null)
      await expect(registry.getEnabledConfig('alipay')).rejects.toThrow('支付渠道未启用')
    })
  })

  describe('getChannelByType', () => {
    it('按类型返回解密后的配置与渠道实例', async () => {
      const plaintext = { appId: 'wx-app-id', apiV3Key: 'wechat-v3-secret-key' }
      prisma.paymentChannelConfig.findMany.mockResolvedValue([
        {
          code: 'wechat',
          name: '微信支付',
          type: 'RECHARGE',
          enabled: true,
          priority: 20,
          config: JSON.stringify(crypto.encryptConfigValues(plaintext)),
        },
      ])

      const result = await registry.getChannelByType('RECHARGE')
      expect(result).not.toBeNull()
      expect(result!.code).toBe('wechat')
      expect(result!.config).toEqual(plaintext)
      expect(result!.channel.code).toBe('wechat')
    })

    it('无可用渠道且开发环境降级 mock', async () => {
      prisma.paymentChannelConfig.findMany.mockResolvedValue([])
      const result = await registry.getChannelByType('PAYOUT')
      expect(result).not.toBeNull()
      expect(result!.code).toBe('mock')
      expect(result!.config).toEqual({})
    })
  })
})
