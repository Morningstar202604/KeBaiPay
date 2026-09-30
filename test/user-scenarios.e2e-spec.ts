// ============================================================================
// KeBaiPay 端到端用户场景集成测试（合规聚合·收单版）
//
// 覆盖收单聚合（paymentOrder 域）下的核心场景：
// 1. 商户收单下单（createOrder → PENDING paymentOrder）
// 2. 我的订单列表 / 账单（paymentOrder 维度）
// 3. 渠道降级 & 重试（ConnectorRouter）
//
// 技术方案：
// - Nest Test.createTestingModule 装载真实业务模块
// - Mock 数据层（PrismaService + RedisService）
// - 钱包/交易/账本/会计分录等资金池概念已下线，不再覆盖
// ============================================================================

import { beforeAll, afterAll, describe, expect, it } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'

// ---- 现存模块导入（已移除 TransactionsModule / AccountsModule）----
import { PaymentChannelsModule } from 'src/payment-channels/payment-channels.module'
import { UsersModule } from 'src/users/users.module'
import { RiskModule } from 'src/risk/risk.module'
import { FinanceModule } from 'src/finance/finance.module'
import { RedisModule } from 'src/redis/redis.module'
import { PrismaModule } from 'src/prisma/prisma.module'
import { CryptoModule } from 'src/crypto/crypto.module'
import { SecurityModule } from 'src/security/security.module'
import { AuditModule } from 'src/audit/audit.module'
import { AuthModule } from 'src/auth/auth.module'
import { BillsModule } from 'src/bills/bills.module'
import { MerchantsModule } from 'src/merchants/merchants.module'
import { CashierModule } from 'src/cashier/cashier.module'
import { WebhooksModule } from 'src/webhooks/webhooks.module'
import { SmsModule } from 'src/sms/sms.module'
import { HealthModule } from 'src/health/health.module'
import { NotificationsModule } from 'src/notifications/notifications.module'
import { ScheduleHealthModule } from 'src/common/schedule-health.module'

// ---- 业务服务（收单/退款/订单维度）----
import { CashierService } from 'src/cashier/cashier.service'
import { RefundService } from 'src/payment-channels/refund.service'
import { RiskEngineService } from 'src/risk/risk-engine.service'
import { UsersService } from 'src/users/users.service'
import { BillsService } from 'src/bills/bills.service'

// ---- 支付通道 ----
import { ConnectorRegistry } from 'src/payment-channels/connector.registry'
import { ConnectorRouter } from 'src/payment-channels/connector-router'

// ---- Mock 层 ----
import { PrismaService } from 'src/prisma/prisma.service'
import { RedisService } from 'src/redis/redis.service'
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

// ============================================================================
// In-Memory Prisma Mock（收单域：paymentOrder / merchant 等）
// ============================================================================

type WhereClause = Record<string, any>

class MemTable {
  items: any[] = []
  constructor(public name: string) {}
}

class MockPrismaClient {
  private tables = new Map<string, MemTable>()

  user = this.model('user')
  merchant = this.model('merchant')
  merchantApp = this.model('merchantApp')
  paymentOrder = this.model('paymentOrder')
  paymentChannelConfig = this.model('paymentChannelConfig')
  riskEvent = this.model('riskEvent')
  systemConfig = this.model('systemConfig')
  channelBillCheck = this.model('channelBillCheck')
  dailySnapshot = this.model('dailySnapshot')
  identityVerification = this.model('identityVerification')

  private model(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new MemTable(name))
    const table = this.tables.get(name)!
    return createModelOps(table, this)
  }

  getTable(name: string): any[] {
    return this.tables.get(name)?.items ?? []
  }

  async $transaction(fnOrOps: any): Promise<any> {
    if (typeof fnOrOps === 'function') return fnOrOps(this)
    if (Array.isArray(fnOrOps)) return Promise.all(fnOrOps)
  }
  async $queryRaw(): Promise<any> {
    return [{ '?column?': 1 }]
  }
  async $connect() { /* no-op */ }
  async $disconnect() { /* no-op */ }
}

function createModelOps(table: MemTable, prisma: MockPrismaClient) {
  function matcher(item: any, where: WhereClause): boolean {
    if (!where) return true
    for (const [key, val] of Object.entries(where)) {
      if (key === 'OR') {
        if (!(val as WhereClause[]).some((s) => matcher(item, s))) return false
        continue
      }
      const itemVal = item[key]
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        if ('in' in val) { if (!(val.in as any[]).includes(itemVal)) return false }
        else if ('gte' in val) { if (!(itemVal >= val.gte)) return false }
        else if ('lte' in val) { if (!(itemVal <= val.lte)) return false }
        else if ('lt' in val) { if (!(itemVal < val.lt)) return false }
        else if ('startsWith' in val) { if (!String(itemVal).startsWith(val.startsWith)) return false }
      } else if (itemVal !== val) return false
    }
    return true
  }

  return {
    findUnique: async (args: any = { where: {} }) => {
      const item = table.items.find((it) =>
        Object.entries(args.where).every(([k, v]) => it[k] === v),
      )
      return item ? { ...item } : null
    },
    findFirst: async (args: any = { where: {} }) => {
      const f = table.items.filter((it) => matcher(it, args.where || {}))
      return f.length ? { ...f[0] } : null
    },
    findMany: async (args: any = {}) => {
      let filtered = table.items.filter((it) => matcher(it, args.where || {}))
      if (args.orderBy) {
        const [field, dir] = Object.entries(args.orderBy)[0] as [string, string]
        filtered = [...filtered].sort((a, b) => (dir === 'desc' ? b[field] > a[field] ? 1 : -1 : a[field] > b[field] ? 1 : -1))
      }
      if (args.skip) filtered = filtered.slice(args.skip)
      if (args.take) filtered = filtered.slice(0, args.take)
      return filtered.map((it) => ({ ...it }))
    },
    create: async (args: any) => {
      const item = { ...args.data }
      if (!item.id) item.id = `mock-${table.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // 模拟 Prisma 的 schema 默认值（paymentOrder.status 默认 PENDING）
      if (table.name === 'paymentOrder' && !item.status) item.status = 'PENDING'
      if (table.name === 'paymentOrder' && !item.createdAt) item.createdAt = new Date()
      table.items.push(item)
      return { ...item }
    },
    update: async (args: any) => {
      const idx = table.items.findIndex((it) => Object.entries(args.where).every(([k, v]) => it[k] === v))
      if (idx === -1) throw new Error(`MockPrisma: ${table.name} update not found`)
      table.items[idx] = { ...table.items[idx], ...args.data }
      return { ...table.items[idx] }
    },
    updateMany: async (args: any = {}) => {
      let count = 0
      for (const it of table.items) {
        if (matcher(it, args.where || {})) { Object.assign(it, args.data); count++ }
      }
      return { count }
    },
    count: async (args: any = {}) => table.items.filter((it) => matcher(it, args.where || {})).length,
    aggregate: async (args: any = {}) => {
      const filtered = table.items.filter((it) => matcher(it, args.where || {}))
      const sum: any = {}
      if (args._sum) for (const f of Object.keys(args._sum)) sum[f] = filtered.reduce((a, it) => a + (it[f] || 0), 0)
      return { _sum: sum, _count: args._count ? filtered.length : 0 }
    },
  }
}

class MockRedisClient {
  private store = new Map<string, any>()
  isEnabled(): boolean { return true }
  async get(k: string) { return this.store.get(k) ?? null }
  async set(k: string, v: any) { this.store.set(k, v) }
  async del(k: string) { this.store.delete(k) }
  async withLock<T>(_k: string, _t: number, fn: () => Promise<T>): Promise<T> { return fn() }
  async slidingWindowCount(): Promise<number> { return 0 }
  async slidingWindowRecord(): Promise<void> { /* no-op */ }
  async ping() { return 'PONG' }
  _reset() { this.store.clear() }
}

// ============================================================================
// 测试套件
// ============================================================================

describe('KeBaiPay E2E — 收单聚合用户场景', () => {
  let module: TestingModule
  let cashierService: CashierService
  let refundService: RefundService
  let usersService: UsersService
  let riskEngine: RiskEngineService
  let billsService: BillsService
  let mockPrisma: MockPrismaClient
  let mockRedis: MockRedisClient

  const merchantUserId = 'm-user-1'

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.CHANNEL_NOTIFY_URL = 'https://test.example.com/webhooks/recharge/mock'
    process.env.MOCK_CHANNEL_SECRET = 'mock-channel-secret-dev-only'
    process.env.JWT_USER_SECRET = 'test-jwt-user-secret-32chars-minimum-length'
    process.env.JWT_AGENT_SECRET = 'test-jwt-agent-secret-32chars-minimum-length'

    mockPrisma = new MockPrismaClient()
    mockRedis = new MockRedisClient()

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({
            NODE_ENV: 'test',
            CHANNEL_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
            MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
          })],
        }),
        PaymentChannelsModule,
        UsersModule,
        RiskModule,
        FinanceModule,
        RedisModule,
        PrismaModule,
        CryptoModule,
        SecurityModule,
        AuditModule,
        AuthModule,
        BillsModule,
        MerchantsModule,
        CashierModule,
        WebhooksModule,
        SmsModule,
        HealthModule,
        NotificationsModule,
        ScheduleHealthModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma as any)
      .overrideProvider(RedisService)
      .useValue(mockRedis as any)
      .compile()

    cashierService = module.get(CashierService)
    refundService = module.get(RefundService)
    usersService = module.get(UsersService)
    riskEngine = module.get(RiskEngineService)
    billsService = module.get(BillsService)
  })

  afterAll(async () => {
    await module?.close()
  })

  describe('场景 1: 商户收单下单（paymentOrder 域）', () => {
    beforeAll(async () => {
      // 种子：审批通过的商户
      await (mockPrisma as any).merchant.create({
        data: {
          id: 'm1',
          userId: merchantUserId,
          merchantNo: 'M001',
          merchantName: '测试商户',
          status: 'APPROVED',
          payRate: 60,
          dailyLimit: 10000000,
        },
      })
    })

    it('商户创建收单订单 → paymentOrder 落库为 PENDING（金额元转分）', async () => {
      const order = await cashierService.createOrder(merchantUserId, {
        merchantOrderNo: 'MO-E2E-1',
        amount: 10,
        subject: '测试商品',
      })
      expect(order.status).toBe('PENDING')
      expect(order.amount).toBe(1000) // 10 元 = 1000 分
      expect(order.merchantId).toBe('m1')

      const rows = mockPrisma.getTable('paymentOrder')
      expect(rows.length).toBe(1)
      expect(rows[0].merchantOrderNo).toBe('MO-E2E-1')
    })

    it('我的订单列表返回该商户的订单', async () => {
      const page = await cashierService.listMyOrders(merchantUserId, { page: 1, limit: 10 })
      expect(page.total).toBe(1)
      expect(page.data[0].merchantOrderNo).toBe('MO-E2E-1')
    })

    it('账单按付款方维度查 paymentOrder', async () => {
      // 同一订单尚未支付：账单不抛错即可（paymentOrder 域）
      const bills = await billsService.findByUser('some-payer', 'EXPENSE' as any)
      expect(Array.isArray(bills)).toBe(true)
    })
  })

  describe('场景 2: 退款服务可注入（收单退款维度，单测已覆盖金额累加）', () => {
    it('RefundService 在容器内可解析', () => {
      expect(refundService).toBeDefined()
    })
  })

  describe('场景 3: 渠道失败降级 & 重试（ConnectorRouter）', () => {
    it('候选全部失败抛错、恢复后成功路由', async () => {
      const router = module.get(ConnectorRouter)
      const registry = module.get(ConnectorRegistry)
      const candidates = registry.getByCapability('RECHARGE' as any)
      expect(candidates.length).toBeGreaterThanOrEqual(1)

      const failing = async (): Promise<never> => { throw new Error('simulated') }
      await expect(
        router.route('RECHARGE' as any, { amount: 100, userId: 'u' }, failing, {
          maxRetries: 0, baseDelayMs: 1, maxDelayMs: 5,
        }),
      ).rejects.toThrow('All connectors failed')

      const ok = async () => ({ ok: true })
      const result = await router.route('RECHARGE' as any, { amount: 100, userId: 'u' }, ok, {
        maxRetries: 0, baseDelayMs: 1, maxDelayMs: 5,
      })
      expect(['wechat_pay', 'alipay', 'mock']).toContain(result.connectorName)
    })
  })
})
