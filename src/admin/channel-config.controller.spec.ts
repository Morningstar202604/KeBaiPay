import { Test } from '@nestjs/testing'
import { ChannelConfigController } from './channel-config.controller'
import { ChannelConfigService } from './channel-config.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit-log.service'
import { PaymentChannelRegistry } from '../payment-channels/payment-channel.registry'
import { ConnectorRegistry } from '../payment-channels/connector.registry'
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard'
import { PermissionsGuard } from './permissions.guard'

describe('ChannelConfigController', () => {
  let controller: ChannelConfigController
  // 同时支持数组形式与回调形式的 $transaction
  // 回调形式下把 mockPrisma 自身作为 tx 传入（含全部表 mock）
  const mockPrisma: any = {
    $transaction: jest.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[])
      return (arg as (tx: any) => Promise<unknown>)(mockPrisma)
    }),
    paymentChannelConfig: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  }
  const mockAuditLog = {
    log: jest.fn().mockResolvedValue(undefined),
  }
  const mockChannelRegistry = {
    getChannel: jest.fn(),
  }
  const mockConnector = {
    getConfig: jest.fn(() => ({})),
    setConfig: jest.fn(),
  }
  const mockConnectorRegistry = {
    get: jest.fn(),
    syncConfig: jest.fn(),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChannelConfigController],
      providers: [
        ChannelConfigService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: PaymentChannelRegistry, useValue: mockChannelRegistry },
        { provide: ConnectorRegistry, useValue: mockConnectorRegistry },
      ],
    })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { sub: 'a1', username: 'admin', role: 'SUPER_ADMIN' }
          return true
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile()
    controller = moduleRef.get(ChannelConfigController)
  })

  beforeEach(() => jest.clearAllMocks())

  it('控制器实例化', () => {
    expect(controller).toBeDefined()
  })

  it('listChannels 脱敏超过 20 位的字符串字段', async () => {
    mockPrisma.paymentChannelConfig.findMany.mockResolvedValue([
      {
        code: 'alipay',
        name: '支付宝',
        config: JSON.stringify({ apiKey: 'short', secret: 'verylongsecretvalue123456' }),
        priority: 10,
      },
    ])
    const result = await controller.listChannels()
    const parsed = JSON.parse(result[0].config)
    // 短字段原样保留
    expect(parsed.apiKey).toBe('short')
    // 长字段截断脱敏
    expect(parsed.secret).toBe('verylong****')
    expect(mockPrisma.paymentChannelConfig.findMany).toHaveBeenCalledWith({
      orderBy: { priority: 'desc' },
    })
  })

  it('listChannels 非法 JSON 配置回退为空对象', async () => {
    mockPrisma.paymentChannelConfig.findMany.mockResolvedValue([
      { code: 'bad', name: '坏配置', config: 'not-json', priority: 1 },
    ])
    const result = await controller.listChannels()
    expect(result[0].config).toBe('{}')
  })

  it('createChannel 写入并记录审计', async () => {
    const created = { code: 'wechat', name: '微信', type: 'RECHARGE' }
    mockPrisma.paymentChannelConfig.create.mockResolvedValue(created)
    const dto = {
      code: 'wechat',
      name: '微信',
      type: 'RECHARGE',
      enabled: true,
      priority: 5,
      config: '{}',
    }
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }
    const result = await controller.createChannel(dto as any, admin as any, req as any)
    expect(result).toEqual(created)
    // 业务写与审计日志必须在同一事务内
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.paymentChannelConfig.create).toHaveBeenCalledWith({
      data: {
        code: 'wechat',
        name: '微信',
        type: 'RECHARGE',
        enabled: true,
        priority: 5,
        config: '{}',
      },
    })
    // auditLog.log 第二参数必须传入 tx
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      {
        adminId: 'a1',
        action: 'CHANNEL_CONFIG_CREATE',
        target: 'wechat',
        detail: { name: '微信', type: 'RECHARGE' },
        ip: '127.0.0.1',
        userAgent: 'jest',
      },
      expect.anything(),
    )
  })

  it('updateChannel 渠道不存在返回 error', async () => {
    mockPrisma.paymentChannelConfig.findUnique.mockResolvedValue(null)
    const result = await controller.updateChannel(
      'missing',
      {} as any,
      { sub: 'a1', role: 'SUPER_ADMIN' } as any,
      { headers: {}, ip: undefined } as any,
    )
    expect(result).toEqual({ error: '渠道不存在' })
  })

  it('updateChannel 合并 config 后更新并记录审计', async () => {
    const existing = {
      code: 'alipay',
      name: '支付宝',
      type: 'RECHARGE',
      enabled: true,
      priority: 10,
      config: JSON.stringify({ a: '1', b: '2' }),
    }
    const updated = { ...existing, name: '支付宝2' }
    mockPrisma.paymentChannelConfig.findUnique.mockResolvedValue(existing)
    mockPrisma.paymentChannelConfig.update.mockResolvedValue(updated)
    const dto = { name: '支付宝2', config: JSON.stringify({ b: '3', c: '4' }) }
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }
    const result = await controller.updateChannel('alipay', dto as any, admin as any, req as any)
    expect(result).toEqual(updated)
    // 业务写与审计日志在同一事务内
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    const updateCall = mockPrisma.paymentChannelConfig.update.mock.calls[0][0]
    expect(updateCall.where).toEqual({ code: 'alipay' })
    expect(updateCall.data.name).toBe('支付宝2')
    const merged = JSON.parse(updateCall.data.config)
    expect(merged).toEqual({ a: '1', b: '3', c: '4' })
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'a1',
        action: 'CHANNEL_CONFIG_UPDATE',
        target: 'alipay',
      }),
      expect.anything(),
    )
  })

  it('deleteChannel 删除并记录审计', async () => {
    mockPrisma.paymentChannelConfig.delete.mockResolvedValue({})
    const admin = { sub: 'a1', role: 'SUPER_ADMIN' }
    const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }
    const result = await controller.deleteChannel('alipay', admin as any, req as any)
    expect(result).toEqual({ success: true })
    // 业务写与审计日志在同一事务内
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.paymentChannelConfig.delete).toHaveBeenCalledWith({ where: { code: 'alipay' } })
    expect(mockAuditLog.log).toHaveBeenCalledWith(
      {
        adminId: 'a1',
        action: 'CHANNEL_CONFIG_DELETE',
        target: 'alipay',
        detail: {},
        ip: '127.0.0.1',
        userAgent: 'jest',
      },
      expect.anything(),
    )
  })

  it('testChannel 返回渠道可用信息', async () => {
    mockChannelRegistry.getChannel.mockReturnValue({ code: 'alipay', name: '支付宝' })
    const result = await controller.testChannel('alipay')
    expect(result).toEqual({
      code: 'alipay',
      name: '支付宝',
      available: true,
      message: '支付宝 渠道可用',
    })
    expect(mockChannelRegistry.getChannel).toHaveBeenCalledWith('alipay')
  })

  it('createChannel 事务提交后同步连接器配置', async () => {
    mockConnectorRegistry.get.mockReturnValue(mockConnector)
    const created = {
      code: 'wechat',
      name: '微信',
      type: 'RECHARGE',
      enabled: true,
      priority: 5,
      config: JSON.stringify({ appId: 'wxa', secret: 's' }),
    }
    mockPrisma.paymentChannelConfig.create.mockResolvedValue(created)
    mockPrisma.paymentChannelConfig.findUnique.mockResolvedValue(created)
    await controller.createChannel(
      { code: 'wechat', name: '微信', type: 'RECHARGE', enabled: true, priority: 5, config: '{}' } as any,
      { sub: 'a1', role: 'SUPER_ADMIN' } as any,
      { headers: {}, ip: '127.0.0.1' } as any,
    )
    // 渠道编码 wechat → 连接器 wechat_pay，同步优先级与凭据
    expect(mockConnectorRegistry.syncConfig).toHaveBeenCalledWith('wechat_pay', {
      priority: 5,
      credentials: { appId: 'wxa', secret: 's' },
    })
  })

  it('updateChannel 事务提交后同步连接器优先级与凭据', async () => {
    mockConnectorRegistry.get.mockReturnValue(mockConnector)
    const existing = {
      code: 'alipay',
      name: '支付宝',
      type: 'RECHARGE',
      enabled: true,
      priority: 10,
      config: JSON.stringify({ appId: 'alix', secret: 's' }),
    }
    const updated = { ...existing, priority: 3 }
    mockPrisma.paymentChannelConfig.findUnique.mockResolvedValue(updated)
    mockPrisma.paymentChannelConfig.update.mockResolvedValue(updated)
    await controller.updateChannel(
      'alipay',
      { priority: 3 } as any,
      { sub: 'a1', role: 'SUPER_ADMIN' } as any,
      { headers: {}, ip: '127.0.0.1' } as any,
    )
    expect(mockConnectorRegistry.syncConfig).toHaveBeenCalledWith('alipay', {
      priority: 3,
      credentials: { appId: 'alix', secret: 's' },
    })
  })

  it('deleteChannel 重置连接器配置（避免残留旧凭据）', async () => {
    mockConnectorRegistry.get.mockReturnValue(mockConnector)
    mockPrisma.paymentChannelConfig.delete.mockResolvedValue({})
    mockPrisma.paymentChannelConfig.findUnique.mockResolvedValue(null)
    await controller.deleteChannel(
      'alipay',
      { sub: 'a1', role: 'SUPER_ADMIN' } as any,
      { headers: {}, ip: '127.0.0.1' } as any,
    )
    expect(mockConnectorRegistry.syncConfig).toHaveBeenCalledWith('alipay', {
      priority: 0,
      credentials: {},
    })
  })

  it('渠道无对应连接器时不调用 syncConfig', async () => {
    mockConnectorRegistry.get.mockReturnValue(undefined)
    mockPrisma.paymentChannelConfig.create.mockResolvedValue({ code: 'unknown' })
    await controller.createChannel(
      { code: 'unknown', name: 'x', type: 'RECHARGE', enabled: true, priority: 1, config: '{}' } as any,
      { sub: 'a1', role: 'SUPER_ADMIN' } as any,
      { headers: {}, ip: '127.0.0.1' } as any,
    )
    expect(mockConnectorRegistry.syncConfig).not.toHaveBeenCalled()
  })
})
