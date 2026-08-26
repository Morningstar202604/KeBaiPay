import { ChannelConfigService } from './channel-config.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit-log.service'
import { CryptoService } from '../crypto/crypto.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { ConnectorRegistry } from '../payment-channels/connector.registry'
import { AdminRole } from '../common/enums'

// 真实 CryptoService（固定测试密钥）：验证凭据加密落库 / 解密读取的完整链路
const crypto = new CryptoService({
  get: () => 'unit-test-encryption-key-0123456789abcdef',
} as never)
crypto.onModuleInit()

describe('ChannelConfigService 凭据加密存储（H1 安全修复）', () => {
  let service: ChannelConfigService
  let prisma: {
    $transaction: jest.Mock
    paymentChannelConfig: Record<
      'findMany' | 'create' | 'findUnique' | 'update',
      jest.Mock
    >
  }
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) }
  const channelRegistry = { getChannel: jest.fn() }
  const connectorRegistry = { get: jest.fn(), syncConfig: jest.fn() }

  const ctx = {
    admin: { sub: 'a1', username: 'admin', role: AdminRole.SUPER_ADMIN },
    ip: '127.0.0.1',
    userAgent: 'jest',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = {
      // 与生产一致：业务写在事务内，回调形式把 mock 自身作为 tx
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
      paymentChannelConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    }
    service = new ChannelConfigService(
      prisma as unknown as PrismaService,
      auditLog as unknown as AuditLogService,
      crypto,
      channelRegistry as unknown as PaymentChannelRegistry,
      connectorRegistry as unknown as ConnectorRegistry,
    )
    // 默认无连接器映射，专注测试存储行为
    connectorRegistry.get.mockReturnValue(undefined)
  })

  it('createChannel：字符串凭据全部以 enc:v1: 密文落库', async () => {
    prisma.paymentChannelConfig.create.mockResolvedValue({ code: 'alipay' })
    const dto = {
      code: 'alipay',
      name: '支付宝',
      type: 'BOTH',
      enabled: true,
      priority: 10,
      config: JSON.stringify({
        appId: '2021003188612345',
        alipayPublicKey: 'MIIBIjANBgkqhki-public',
        privateKey: 'MIIEvQIBADANBg-secret-private-key',
      }),
    }

    await service.createChannel(dto, ctx)

    const arg = prisma.paymentChannelConfig.create.mock.calls[0][0] as {
      data: { config: string }
    }
    const stored = JSON.parse(arg.data.config) as Record<string, string>
    expect(stored.privateKey).toMatch(/^enc:v1:/)
    expect(stored.privateKey).not.toContain('secret-private-key')
    expect(stored.alipayPublicKey).toMatch(/^enc:v1:/)
    // 解密还原明文
    expect(crypto.decryptConfigValues(stored)).toEqual({
      appId: '2021003188612345',
      alipayPublicKey: 'MIIBIjANBgkqhki-public',
      privateKey: 'MIIEvQIBADANBg-secret-private-key',
    })
  })

  it('listChannels：返回解密后脱敏配置，不泄漏完整密钥', async () => {
    const plaintext = { apiKey: 'short', secret: 'verylongsecretvalue123456' }
    prisma.paymentChannelConfig.findMany.mockResolvedValue([
      {
        code: 'alipay',
        name: '支付宝',
        type: 'BOTH',
        priority: 10,
        config: JSON.stringify(crypto.encryptConfigValues(plaintext)),
      },
    ])

    const result = await service.listChannels()
    const parsed = JSON.parse(result[0].config) as Record<string, string>
    expect(parsed.secret).toBe('verylong****')
    expect(JSON.stringify(parsed)).not.toContain('verylongsecretvalue123456')
    expect(JSON.stringify(parsed)).not.toMatch(/enc:v1:/)
  })

  it('updateChannel：历史明文存量在更新时迁移为密文', async () => {
    prisma.paymentChannelConfig.findUnique.mockResolvedValue({
      code: 'mock',
      name: '模拟渠道',
      type: 'BOTH',
      enabled: true,
      priority: 1,
      config: JSON.stringify({ secretKey: 'legacy-plain-secret' }),
    })
    prisma.paymentChannelConfig.update.mockResolvedValue({})

    await service.updateChannel('mock', {}, ctx)

    const arg = prisma.paymentChannelConfig.update.mock.calls[0][0] as {
      data: { config: string }
    }
    const stored = JSON.parse(arg.data.config) as Record<string, string>
    expect(stored.secretKey).toMatch(/^enc:v1:/)
    expect(stored.secretKey).not.toBe('legacy-plain-secret')
  })

  it('syncConnector：向连接器同步的是解密后的凭据', async () => {
    connectorRegistry.get.mockReturnValue({})
    const plaintext = { appId: 'wx-app-id', apiV3Key: 'wechat-v3-secret' }
    prisma.paymentChannelConfig.findUnique.mockResolvedValue({
      code: 'wechat',
      name: '微信支付',
      type: 'RECHARGE',
      enabled: true,
      priority: 20,
      config: JSON.stringify(crypto.encryptConfigValues(plaintext)),
    })

    await service.updateChannel('wechat', {}, ctx)

    expect(connectorRegistry.syncConfig).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: plaintext }),
    )
  })
})
