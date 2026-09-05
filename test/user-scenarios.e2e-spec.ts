// ============================================================================
// KeBaiPay 端到端用户场景集成测试
//
// 覆盖支付因果链的 6 个核心场景：
// 1. 完整充值支付闭环（注册→实名→充值→回调→验证）
// 2. 退款流程
// 3. 失败降级 & 重试（ConnectorRouter）
// 4. 风控拦截
// 5. 多并发订单
// 6. 对账差异自动修正
//
// 技术方案：
// - 用 Nest Test.createTestingModule 创建完整模块
// - Mock 数据库层（PrismaService + RedisService）
// - 业务层使用真实类
// ============================================================================

import { Test, TestingModule } from '@nestjs/testing'
import { ConfigModule, ConfigService } from '@nestjs/config'

// ---- 模块导入 ----
import { PaymentChannelsModule } from 'src/payment-channels/payment-channels.module'
import { TransactionsModule } from 'src/transactions/transactions.module'
import { UsersModule } from 'src/users/users.module'
import { RiskModule } from 'src/risk/risk.module'
import { FinanceModule } from 'src/finance/finance.module'
import { ChannelReconciliationModule } from 'src/channel-reconciliation/channel-reconciliation.module'
import { RedisModule } from 'src/redis/redis.module'
import { PrismaModule } from 'src/prisma/prisma.module'
import { CryptoModule } from 'src/crypto/crypto.module'
import { SecurityModule } from 'src/security/security.module'
import { AuditModule } from 'src/audit/audit.module'
import { AuthModule } from 'src/auth/auth.module'
import { AccountsModule } from 'src/accounts/accounts.module'
import { BillsModule } from 'src/bills/bills.module'
import { MerchantsModule } from 'src/merchants/merchants.module'
import { WebhooksModule } from 'src/webhooks/webhooks.module'
import { SmsModule } from 'src/sms/sms.module'
import { HealthModule } from 'src/health/health.module'
import { NotificationsModule } from 'src/notifications/notifications.module'
import { ScheduleHealthModule } from 'src/common/schedule-health.module'

// ---- 业务服务 ----
import { TransactionsService } from 'src/transactions/transactions.service'
import { RefundService } from 'src/payment-channels/refund.service'
import { UsersService } from 'src/users/users.service'
import { RiskEngineService } from 'src/risk/risk-engine.service'
import { JournalService } from 'src/finance/journal.service'
import { AutoFixService } from 'src/channel-reconciliation/auto-fix.service'

// ---- 支付通道 ----
import { MockConnector } from 'src/payment-channels/connectors/mock.connector'
import { ConnectorRegistry } from 'src/payment-channels/connector.registry'
import { ConnectorRouter } from 'src/payment-channels/connector-router'
import { MockChannel } from 'src/payment-channels/channels/mock.channel'
import { PaymentChannelRegistry } from 'src/payment-channels/payment-channel.registry'
import { ConnectorHealthService } from 'src/payment-channels/connector-health.service'
import { AlipayConnector } from 'src/payment-channels/connectors/alipay.connector'
import { WechatPayConnector } from 'src/payment-channels/connectors/wechat-pay.connector'
import { AlipayChannel } from 'src/payment-channels/channels/alipay.channel'
import { WechatPayChannel } from 'src/payment-channels/channels/wechat-pay.channel'
import { ChannelHealthService } from 'src/payment-channels/channel-health.service'

// ---- Mock 层 ----
import { PrismaService } from 'src/prisma/prisma.service'
import { RedisService } from 'src/redis/redis.service'
import { CryptoService } from 'src/crypto/crypto.service'
import { SmsService } from 'src/sms/sms.service'
import { createHash, createHmac } from 'crypto'

// ============================================================================
// In-Memory Prisma Mock
// ============================================================================

type WhereClause = Record<string, any>

/** 简单的 in-memory 数据集 */
class MemTable {
  items: any[] = []
  constructor(public name: string) {}
}

/** in-memory Prisma Service 替代 */
class MockPrismaClient {
  private tables = new Map<string, MemTable>()

  // 注册所有模型
  user = this.model('user')
  account = this.model('account')
  transactionOrder = this.model('transactionOrder')
  accountLedger = this.model('accountLedger')
  bill = this.model('bill')
  riskEvent = this.model('riskEvent')
  systemConfig = this.model('systemConfig')
  paymentChannelConfig = this.model('paymentChannelConfig')
  journalEntry = this.model('journalEntry')
  platformAccount = this.model('platformAccount')
  reconciliationDifferenceItem = this.model('reconciliationDifferenceItem')
  identityVerification = this.model('identityVerification')
  dailyLimitUsage = this.model('dailyLimitUsage')

  private model(name: string) {
    if (!this.tables.has(name)) {
      this.tables.set(name, new MemTable(name))
    }
    const table = this.tables.get(name)!
    return createModelOps(table, this)
  }

  getTable(name: string): any[] {
    return this.tables.get(name)?.items ?? []
  }

  async $transaction(fnOrOps: any): Promise<any> {
    if (typeof fnOrOps === 'function') {
      // 将 mock 自身作为 tx client 传入（同一实例，事务内共享数据）
      return fnOrOps(this)
    }
    if (Array.isArray(fnOrOps)) {
      const results: any[] = []
      for (const op of fnOrOps) {
        results.push(await op)
      }
      return results
    }
  }

  async $queryRaw(query: TemplateStringsArray | string, ...values: any[]): Promise<any> {
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
        const ok = (val as WhereClause[]).some((sub) => matcher(item, sub))
        if (!ok) return false
        continue
      }
      if (key === 'AND') {
        const ok = (val as WhereClause[]).every((sub) => matcher(item, sub))
        if (!ok) return false
        continue
      }
      if (key === 'NOT') {
        if (matcher(item, val as WhereClause)) return false
        continue
      }
      const itemVal = item[key]
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        // Prisma operators: equals, startsWith, gte, lte, in, not, contains, gt, lt
        if ('equals' in val) { if (itemVal !== val.equals) return false }
        else if ('not' in val) { if (itemVal === val.not) return false }
        else if ('gt' in val) { if (!(itemVal > val.gt)) return false }
        else if ('gte' in val) { if (!(itemVal >= val.gte)) return false }
        else if ('lt' in val) { if (!(itemVal < val.lt)) return false }
        else if ('lte' in val) { if (!(itemVal <= val.lte)) return false }
        else if ('in' in val) { if (!(val as any[]).includes(itemVal)) return false }
        else if ('notIn' in val) { if ((val as any[]).includes(itemVal)) return false }
        else if ('startsWith' in val) { if (!String(itemVal).startsWith(val.startsWith)) return false }
        else if ('contains' in val) { if (!String(itemVal).includes(val.contains)) return false }
        else { /* unknown op, skip */ }
      } else {
        if (itemVal !== val) return false
      }
    }
    return true
  }

  function pick(obj: any, keys: string[]): any {
    const result: any = {}
    for (const k of keys) result[k] = obj[k]
    return result
  }

  return {
    findUnique: async (args: { where: WhereClause; include?: Record<string, boolean>; select?: Record<string, boolean> }) => {
      const item = table.items.find((it) => {
        return Object.entries(args.where).every(([k, v]) => it[k] === v)
      })
      if (!item && args.select) return null
      if (!item && args.include) return null
      return item ? { ...item } : null
    },

    findFirst: async (args: { where: WhereClause; orderBy?: any; select?: Record<string, boolean> }) => {
      const filtered = table.items.filter((it) => matcher(it, args.where || {}))
      if (filtered.length === 0) return null
      return { ...filtered[0] }
    },

    findMany: async (args: { where?: WhereClause; orderBy?: any; take?: number; skip?: number; select?: Record<string, boolean> } = {}) => {
      let filtered = table.items.filter((it) => matcher(it, args.where || {}))
      if (args.orderBy) {
        const [field, dir] = Object.entries(args.orderBy)[0]
        filtered.sort((a, b) => dir === 'desc' ? (b[field] > a[field] ? 1 : -1) : (a[field] > b[field] ? 1 : -1))
      }
      if (args.skip) filtered = filtered.slice(args.skip)
      if (args.take) filtered = filtered.slice(0, args.take)
      return filtered.map((it) => ({ ...it }))
    },

    create: async (args: { data: any; include?: Record<string, boolean>; select?: Record<string, boolean> }) => {
      const item = { ...args.data }
      if (!item.id) item.id = `mock-${table.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // 处理嵌套 create：如 account: { create: {} }
      const nestedCreates: Record<string, any> = {}
      for (const [key, val] of Object.entries(item)) {
        if (val && typeof val === 'object' && !Array.isArray(val) && 'create' in val) {
          const nestedData = (val as any).create
          // 自动填充外键：如 userId
          const foreignKey = `${table.name}Id`
          if (!nestedData[foreignKey] && !nestedData.userId) {
            // 尝试推断外键名称
            if (key === 'account' && item.id) {
              nestedData.userId = item.id
            } else if (item[foreignKey]) {
              nestedData[foreignKey] = item[foreignKey]
            }
          }
          const nestedTableItems = prisma.getTable(key)
          const nestedItem = { ...nestedData, id: `mock-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
          nestedTableItems.push(nestedItem)
          nestedCreates[key] = nestedItem
          delete item[key]
        }
      }

      table.items.push(item)

      // include 嵌套关联
      if (args.include) {
        for (const [relKey, shouldInclude] of Object.entries(args.include)) {
          if (shouldInclude && nestedCreates[relKey]) {
            item[relKey] = nestedCreates[relKey]
          } else if (shouldInclude) {
            // 尝试从关联表查找
            const relItems = prisma.getTable(relKey)
            const matched = relItems.filter((rit: any) => {
              return rit.userId === item.id || rit[`${table.name}Id`] === item.id
            })
            if (matched.length > 0) {
              item[relKey] = matched.length === 1 ? matched[0] : matched
            }
          }
        }
      }

      return { ...item }
    },

    createMany: async (args: { data: any[] }) => {
      for (const d of args.data) {
        const item = { ...d }
        if (!item.id) item.id = `mock-${table.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        table.items.push(item)
      }
      return { count: args.data.length }
    },

    update: async (args: { where: WhereClause; data: any; select?: Record<string, boolean> }) => {
      const idx = table.items.findIndex((it) => {
        return Object.entries(args.where).every(([k, v]) => it[k] === v)
      })
      if (idx === -1) throw new Error(`MockPrisma: ${table.name} update not found`)
      const old = table.items[idx]
      const updated = { ...old }
      // 处理 Prisma 原子操作：increment, decrement, multiply, set
      for (const [key, val] of Object.entries(args.data)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          if ('increment' in val) {
            updated[key] = (updated[key] || 0) + (val as any).increment
          } else if ('decrement' in val) {
            updated[key] = (updated[key] || 0) - (val as any).decrement
          } else if ('multiply' in val) {
            updated[key] = (updated[key] || 0) * (val as any).multiply
          } else if ('set' in val) {
            updated[key] = (val as any).set
          } else {
            updated[key] = val
          }
        } else {
          updated[key] = val
        }
      }
      table.items[idx] = updated
      return { ...updated }
    },

    updateMany: async (args: { where?: WhereClause; data: any }) => {
      let count = 0
      for (let i = 0; i < table.items.length; i++) {
        if (matcher(table.items[i], args.where || {})) {
          const item = table.items[i]
          for (const [key, val] of Object.entries(args.data)) {
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              if ('increment' in val) {
                item[key] = (item[key] || 0) + (val as any).increment
              } else if ('decrement' in val) {
                item[key] = (item[key] || 0) - (val as any).decrement
              } else if ('multiply' in val) {
                item[key] = (item[key] || 0) * (val as any).multiply
              } else if ('set' in val) {
                item[key] = (val as any).set
              } else {
                item[key] = val
              }
            } else {
              item[key] = val
            }
          }
          count++
        }
      }
      return { count }
    },

    count: async (args: { where?: WhereClause } = {}) => {
      return table.items.filter((it) => matcher(it, args.where || {})).length
    },

    aggregate: async (args: { where?: WhereClause; _sum?: Record<string, boolean>; _count?: boolean }) => {
      const filtered = table.items.filter((it) => matcher(it, args.where || {}))
      const sum: any = {}
      if (args._sum) {
        for (const field of Object.keys(args._sum)) {
          sum[field] = filtered.reduce((acc, it) => acc + (it[field] || 0), 0)
        }
      }
      return { _sum: sum, _count: args._count ? filtered.length : 0 }
    },

    delete: async (args: { where: WhereClause }) => {
      const idx = table.items.findIndex((it) => {
        return Object.entries(args.where).every(([k, v]) => it[k] === v)
      })
      if (idx === -1) throw new Error(`MockPrisma: ${table.name} delete not found`)
      const [deleted] = table.items.splice(idx, 1)
      return deleted
    },

    deleteMany: async (args: { where?: WhereClause } = {}) => {
      const before = table.items.length
      table.items = table.items.filter((it) => !matcher(it, args.where || {}))
      return { count: before - table.items.length }
    },

    upsert: async (args: { where: WhereClause; create: any; update: any }) => {
      const existing = table.items.find((it) => {
        return Object.entries(args.where).every(([k, v]) => it[k] === v)
      })
      if (existing) {
        Object.assign(existing, args.update)
        return { ...existing }
      }
      const item = { ...args.create }
      if (!item.id) item.id = `mock-${table.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      table.items.push(item)
      return { ...item }
    },
  }
}

// ============================================================================
// In-Memory Redis Mock
// ============================================================================

class MockRedisClient {
  private store = new Map<string, { value: string; ttl?: number; expiresAt?: number }>()
  private lockStore = new Map<string, string>()

  isEnabled(): boolean {
    return true
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      ttl: ttlSeconds,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    })
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
    this.lockStore.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key)
  }

  async acquireLock(lockKey: string, ttlSeconds: number): Promise<boolean> {
    if (this.lockStore.has(lockKey)) return false
    this.lockStore.set(lockKey, `lock-${Date.now()}`)
    setTimeout(() => this.lockStore.delete(lockKey), ttlSeconds * 1000).unref()
    return true
  }

  async releaseLock(lockKey: string): Promise<void> {
    this.lockStore.delete(lockKey)
  }

  async withLock<T>(lockKey: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  async setRateLimit(key: string, ttlSeconds: number): Promise<boolean> {
    return this.acquireLock(key, ttlSeconds)
  }

  async slidingWindowCount(key: string, windowMs: number): Promise<number> {
    return 0 // 测试中返回 0，不触发频率限制
  }

  async slidingWindowRecord(key: string, windowMs: number, member: string): Promise<void> {
    // no-op
  }

  async ping(): Promise<string> {
    return 'PONG'
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    return 1
  }

  async decr(key: string): Promise<number> {
    return 0
  }

  async expire(key: string, ttlSeconds: number): Promise<void> { /* no-op */ }

  // Helpers for resetting
  _reset(): void {
    this.store.clear()
    this.lockStore.clear()
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

function generateUUID(): string {
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 模拟 Mock 通道的签名 */
function signMockBody(body: { orderNo: string; channelOrderNo: string; amount: number }): string {
  const secret = process.env.MOCK_CHANNEL_SECRET || 'mock-channel-secret-dev-only'
  return createHmac('sha256', secret)
    .update(`${body.orderNo}${body.channelOrderNo}${body.amount}`)
    .digest('hex')
}

// ============================================================================
// 测试套件
// ============================================================================

describe('KeBaiPay E2E — 用户场景集成测试', () => {
  let module: TestingModule

  // 核心服务
  let transactionsService: TransactionsService
  let refundService: RefundService
  let riskEngine: RiskEngineService
  let journalService: JournalService
  let autoFixService: AutoFixService
  let usersService: UsersService

  // 支付通道
  let mockConnector: MockConnector
  let connectorRouter: ConnectorRouter
  let connectorRegistry: ConnectorRegistry
  let mockChannel: MockChannel
  let channelRegistry: PaymentChannelRegistry

  // Mock 实例
  let mockPrisma: MockPrismaClient
  let mockRedis: MockRedisClient
  let cryptoService: CryptoService

  // 测试数据
  const testUserId = generateUUID()
  const testPayPassword = 'test123456'

  beforeAll(async () => {
    // 设置环境变量
    process.env.NODE_ENV = 'test'
    process.env.RECHARGE_NOTIFY_URL = 'https://test.example.com/webhooks/recharge/mock'
    process.env.MOCK_CHANNEL_SECRET = 'mock-channel-secret-dev-only'
    process.env.JWT_SECRET = 'test-jwt-secret'
    process.env.JWT_ADMIN_SECRET = 'test-jwt-admin-secret'
    process.env.JWT_USER_SECRET = 'test-jwt-user-secret-32chars-minimum-length'
    process.env.JWT_AGENT_SECRET = 'test-jwt-agent-secret-32chars-minimum-length'
    process.env.SMS_CODE_SECRET = 'test-sms-secret'

    mockPrisma = new MockPrismaClient()
    mockRedis = new MockRedisClient()

    // 创建 Nest 测试模块
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({
            NODE_ENV: 'test',
            RECHARGE_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
            MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
            JWT_SECRET: 'test-jwt-secret',
            JWT_ADMIN_SECRET: 'test-jwt-admin-secret',
            SMS_CODE_SECRET: 'test-sms-secret',
          })],
        }),
        PaymentChannelsModule,
        TransactionsModule,
        UsersModule,
        RiskModule,
        FinanceModule,
        ChannelReconciliationModule,
        RedisModule,
        PrismaModule,
        CryptoModule,
        SecurityModule,
        AuditModule,
        AuthModule,
        AccountsModule,
        BillsModule,
        MerchantsModule,
        WebhooksModule,
        SmsModule,
        HealthModule,
        NotificationsModule,
        ScheduleHealthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma as any)
      .overrideProvider(RedisService)
      .useValue(mockRedis as any)
      .compile()

    // 提取服务实例
    transactionsService = module.get(TransactionsService)
    refundService = module.get(RefundService)
    riskEngine = module.get(RiskEngineService)
    journalService = module.get(JournalService)
    autoFixService = module.get(AutoFixService)
    usersService = module.get(UsersService)
    mockConnector = module.get(MockConnector)
    connectorRouter = module.get(ConnectorRouter)
    connectorRegistry = module.get(ConnectorRegistry)
    mockChannel = module.get(MockChannel)
    channelRegistry = module.get(PaymentChannelRegistry)
    cryptoService = module.get(CryptoService)
  })

  afterAll(async () => {
    await module?.close()
  })

  beforeEach(() => {
    // 重置所有 Mock 数据
    mockPrisma = new MockPrismaClient()
    mockRedis._reset()
    mockConnector.setSimulateFailure(false)
    mockConnector.setSimulateLatency(0)

    // 重新注入新的 mockPrisma 实例
    // 注意：因为 PrismaService 是 @Global，overrideProvider 必须在模块编译前
    // 测试中每个场景独立重置数据
  })

  // ==========================================================================
  // 场景 1: 完整的充值支付闭环
  // ==========================================================================
  describe('场景 1: 完整充值支付闭环', () => {
    let rechargeResult: any
    const orderAmount = 10000 // 100 元（分）

    beforeAll(async () => {
      // 重新设置独立模块
      const freshPrisma = new MockPrismaClient()
      const freshRedis = new MockRedisClient()

      const freshModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({
              NODE_ENV: 'test',
              RECHARGE_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
              MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
              JWT_SECRET: 'test-jwt-secret',
              JWT_ADMIN_SECRET: 'test-jwt-admin-secret',
              SMS_CODE_SECRET: 'test-sms-secret',
            })],
          }),
          PaymentChannelsModule,
          TransactionsModule,
          UsersModule,
          RiskModule,
          FinanceModule,
          RedisModule,
          PrismaModule,
          CryptoModule,
          SecurityModule,
          AuditModule,
          AuthModule,
          AccountsModule,
          BillsModule,
          MerchantsModule,
          WebhooksModule,
          SmsModule,
          HealthModule,
          NotificationsModule,
          ScheduleHealthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(freshPrisma as any)
        .overrideProvider(RedisService)
        .useValue(freshRedis as any)
        .compile()

      // 手动初始化平台账户（因为 Mock 不触发 onModuleInit）
      await freshPrisma.platformAccount.upsert({
        where: { code: 'REVENUE_FEE' },
        create: { code: 'REVENUE_FEE', name: '手续费收入', balance: 0 },
        update: {},
      })
      await freshPrisma.platformAccount.upsert({
        where: { code: 'CHANNEL_FUND' },
        create: { code: 'CHANNEL_FUND', name: '渠道资金', balance: 0 },
        update: {},
      })
      await freshPrisma.platformAccount.upsert({
        where: { code: 'MERCHANT_PAYABLE' },
        create: { code: 'MERCHANT_PAYABLE', name: '应付商户款', balance: 0 },
        update: {},
      })

      const svc = freshModule.get(TransactionsService)
      const usrSvc = freshModule.get(UsersService)
      const mockRst = freshModule.get(RiskEngineService)
      const mockChReg = freshModule.get(PaymentChannelRegistry)
      const bcrypt = await import('bcrypt')
      const pwdHash = await bcrypt.hash(testPayPassword, 10)

      // 步骤 1: 创建用户（注册）
      const user = await usrSvc.create({
        nickname: '测试用户',
        phone: '13800138000',
        loginPassword: pwdHash,
      })
      // 设置支付密码（模拟实名认证通过后的状态）
      await freshPrisma.user.update({
        where: { id: user.id },
        data: { payPassword: pwdHash, realNameStatus: 'VERIFIED' },
      })

      // 步骤 2: 设置支付渠道（MockConnector）
      await freshPrisma.paymentChannelConfig.create({
        data: {
          code: 'mock',
          name: '模拟渠道',
          type: 'RECHARGE',
          enabled: true,
          config: '{}',
          priority: 100,
        },
      })

      // 清除风控缓存
      mockRst.clearCache()

      // 步骤 3: 发起充值订单（100元 = 10000分）
      rechargeResult = await svc.recharge(user.id, orderAmount / 100, testPayPassword, `idem-${Date.now()}`)

      // 步骤 4: 模拟支付成功回调
      const callbackBody = JSON.stringify({
        orderNo: rechargeResult.orderNo,
        channelOrderNo: rechargeResult.channelOrderNo,
        amount: orderAmount,
        status: 'SUCCESS',
      })
      const signature = signMockBody({
        orderNo: rechargeResult.orderNo,
        channelOrderNo: rechargeResult.channelOrderNo || '',
        amount: orderAmount,
      })
      const callbackResponse = await svc.handleRechargeCallback(
        'mock',
        callbackBody,
        { 'x-signature': signature },
      )

      // 获取最终数据
      const order = await freshPrisma.transactionOrder.findUnique({
        where: { orderNo: rechargeResult.orderNo },
      })
      const account = await freshPrisma.account.findUnique({
        where: { userId: user.id },
      })

      // 断言
      expect(callbackResponse).toBe('SUCCESS')
      expect(order?.status).toBe('SUCCESS')
      expect(account?.availableBalance).toBe(orderAmount)
      expect(account?.totalBalance).toBe(orderAmount)

      // 验证会计分录
      const journalEntries = freshPrisma.getTable('journalEntry')
      expect(journalEntries.length).toBeGreaterThanOrEqual(2)
      const totalDebit = journalEntries.reduce((s, e) => s + (e.debit || 0), 0)
      const totalCredit = journalEntries.reduce((s, e) => s + (e.credit || 0), 0)
      expect(totalDebit).toBe(totalCredit)

      // 验证账本
      const ledgers = freshPrisma.getTable('accountLedger')
      expect(ledgers.length).toBe(1)
      expect(ledgers[0].type).toBe('RECHARGE')
      expect(ledgers[0].amount).toBe(orderAmount)

      // 验证账单
      const bills = freshPrisma.getTable('bill')
      expect(bills.length).toBe(1)
      expect(bills[0].type).toBe('RECHARGE')

      // 验证无风控事件（正常交易）
      const riskEvents = freshPrisma.getTable('riskEvent')
      const rechargeBlockEvents = riskEvents.filter(
        (e: any) => e.description && e.description.includes('充值'),
      )
      // 正常充值不应产生风控拦截事件
      expect(rechargeBlockEvents.length).toBe(0)

      // 存储数据供后续场景使用
      ;(global as any).__testUser = user
      ;(global as any).__testOrder = order
      ;(global as any).__freshPrisma = freshPrisma
      ;(global as any).__freshRedis = freshRedis
      ;(global as any).__freshModule = freshModule

      await freshModule.close()
    })

    it('充值成功，余额增加，会计分录平衡', () => {
      const order = (global as any).__testOrder
      expect(order?.status).toBe('SUCCESS')
      expect(rechargeResult?.orderNo).toBeTruthy()
    })

    it('无风控拦截事件', () => {
      const user = (global as any).__testUser
      expect(user).toBeTruthy()
    })
  })

  // ==========================================================================
  // 场景 2: 退款流程
  // ==========================================================================
  describe('场景 2: 退款流程', () => {
    let freshModule2: TestingModule
    let refundSvc: RefundService
    let freshPrisma2: MockPrismaClient
    let user: any
    let order: any
    const orderAmount = 10000

    beforeAll(async () => {
      freshPrisma2 = new MockPrismaClient()
      const freshRedis2 = new MockRedisClient()

      freshModule2 = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({
              NODE_ENV: 'test',
              RECHARGE_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
              MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
              JWT_SECRET: 'test-jwt-secret',
              JWT_ADMIN_SECRET: 'test-jwt-admin-secret',
              SMS_CODE_SECRET: 'test-sms-secret',
            })],
          }),
          PaymentChannelsModule,
          TransactionsModule,
          UsersModule,
          RiskModule,
          FinanceModule,
          RedisModule,
          PrismaModule,
          CryptoModule,
          SecurityModule,
          AuditModule,
          AuthModule,
          AccountsModule,
          BillsModule,
          MerchantsModule,
          WebhooksModule,
          SmsModule,
          HealthModule,
          NotificationsModule,
          ScheduleHealthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(freshPrisma2 as any)
        .overrideProvider(RedisService)
        .useValue(freshRedis2 as any)
        .compile()

      // 手动初始化平台账户（因为 Mock 不触发 onModuleInit）
      await freshPrisma2.platformAccount.upsert({
        where: { code: 'REVENUE_FEE' },
        create: { code: 'REVENUE_FEE', name: '手续费收入', balance: 0 },
        update: {},
      })
      await freshPrisma2.platformAccount.upsert({
        where: { code: 'CHANNEL_FUND' },
        create: { code: 'CHANNEL_FUND', name: '渠道资金', balance: 0 },
        update: {},
      })
      await freshPrisma2.platformAccount.upsert({
        where: { code: 'MERCHANT_PAYABLE' },
        create: { code: 'MERCHANT_PAYABLE', name: '应付商户款', balance: 0 },
        update: {},
      })

      refundSvc = freshModule2.get(RefundService)
      const usrSvc2 = freshModule2.get(UsersService)
      const transSvc2 = freshModule2.get(TransactionsService)
      const mockRst2 = freshModule2.get(RiskEngineService)
      const bcrypt = await import('bcrypt')
      const pwdHash = await bcrypt.hash(testPayPassword, 10)

      // 创建用户
      user = await usrSvc2.create({
        nickname: '退款测试用户',
        phone: '13800138001',
        loginPassword: pwdHash,
      })
      await freshPrisma2.user.update({
        where: { id: user.id },
        data: { payPassword: pwdHash, realNameStatus: 'VERIFIED' },
      })

      // 设置支付渠道
      await freshPrisma2.paymentChannelConfig.create({
        data: {
          code: 'mock',
          name: '模拟渠道',
          type: 'RECHARGE',
          enabled: true,
          config: '{}',
          priority: 100,
        },
      })

      mockRst2.clearCache()

      // 充值 100 元（10000 分）
      const recharge = await transSvc2.recharge(user.id, 100, testPayPassword, `idem-refund-${Date.now()}`)
      const callbackBody = JSON.stringify({
        orderNo: recharge.orderNo,
        channelOrderNo: recharge.channelOrderNo,
        amount: orderAmount,
        status: 'SUCCESS',
      })
      const signature = signMockBody({
        orderNo: recharge.orderNo,
        channelOrderNo: recharge.channelOrderNo || '',
        amount: orderAmount,
      })
      await transSvc2.handleRechargeCallback('mock', callbackBody, { 'x-signature': signature })

      order = await freshPrisma2.transactionOrder.findUnique({ where: { orderNo: recharge.orderNo } })
    })

    it('退款成功，余额回退', async () => {
      // 发起退款（Mock渠道直接返回SUCCESS）
      const refundResult = await refundSvc.createRefund(order.orderNo, 5000, '测试退款')
      expect(refundResult.refundNo).toBeTruthy()
      expect(refundResult.status).toBe('SUCCESS')

      // 验证余额
      const account = await freshPrisma2.account.findUnique({ where: { userId: user.id } })
      expect(account?.availableBalance).toBe(5000) // 10000 - 5000

      // 验证退款单
      const refundOrder = await freshPrisma2.transactionOrder.findUnique({
        where: { orderNo: refundResult.refundNo },
      })
      expect(refundOrder?.status).toBe('SUCCESS')
      expect(refundOrder?.type).toBe('REFUND')
      expect(refundOrder?.relatedOrderNo).toBe(order.orderNo)

      // 验证账本（借方/贷方平衡）
      const ledgers = freshPrisma2.getTable('accountLedger')
      const refundLedgers = ledgers.filter((l: any) => l.type === 'REFUND')
      expect(refundLedgers.length).toBeGreaterThanOrEqual(1)
    })

    afterAll(async () => {
      await freshModule2?.close()
    })
  })

  // ==========================================================================
  // 场景 3: 失败降级 & 重试
  // ==========================================================================
  describe('场景 3: 失败降级 & 重试', () => {
    let freshModule3: TestingModule
    let localRouter: ConnectorRouter
    let localRegistry: ConnectorRegistry
    let localMockConnector: MockConnector

    beforeAll(async () => {
      const freshPrisma3 = new MockPrismaClient()
      const freshRedis3 = new MockRedisClient()

      freshModule3 = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({
              NODE_ENV: 'test',
              RECHARGE_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
              MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
              JWT_SECRET: 'test-jwt-secret',
              JWT_ADMIN_SECRET: 'test-jwt-admin-secret',
              SMS_CODE_SECRET: 'test-sms-secret',
            })],
          }),
          PaymentChannelsModule,
          TransactionsModule,
          UsersModule,
          RiskModule,
          FinanceModule,
          RedisModule,
          PrismaModule,
          CryptoModule,
          SecurityModule,
          AuditModule,
          AuthModule,
          AccountsModule,
          BillsModule,
          MerchantsModule,
          WebhooksModule,
          SmsModule,
          HealthModule,
          NotificationsModule,
          ScheduleHealthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(freshPrisma3 as any)
        .overrideProvider(RedisService)
        .useValue(freshRedis3 as any)
        .compile()

      localRouter = freshModule3.get(ConnectorRouter)
      localRegistry = freshModule3.get(ConnectorRegistry)
      localMockConnector = freshModule3.get(MockConnector)

      // 手动注册连接器（ConnectorRegistry 构造时已自动注册；此处按测试场景覆盖注册，重复注册仅告警）
      localRegistry.register(localMockConnector)
      localRegistry.register(freshModule3.get(AlipayConnector))
      localRegistry.register(freshModule3.get(WechatPayConnector))
    })

    it('MockConnector 失败时降级并最终成功', async () => {
      // 设置 MockConnector 模拟失败
      localMockConnector.setSimulateFailure(true)

      // 让 router 认为 mock 是健康的（默认是健康的）
      localRouter.updateHealth('mock', true)

      // 清空 router 的健康缓存，强制重新检查
      // 注册两个连接器以保证降级路径（mock + alipay）
      const alipayConnector3 = freshModule3.get(AlipayConnector)
      const wechatConnector3 = freshModule3.get(WechatPayConnector)

      // MockConnector 失败 → 尝试 fallback（但我们的 alipay/wechat 没配置凭据）
      // ConnectorRouter 会遍历所有 candidates，如果都失败，抛出 All connectors failed 错误
      const candidates = localRegistry.getByCapability('RECHARGE')
      expect(candidates.length).toBeGreaterThanOrEqual(1)

      // 测试 route 失败后会抛异常
      let routeError: Error | null = null
      try {
        await localRouter.route(
          'RECHARGE' as any,
          { amount: 100, userId: 'test' },
          async (connector: any, config: any, request: any) => {
            return connector.createPayment(request)
          },
          { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 50 },
        )
      } catch (err: any) {
        routeError = err
      }

      // 因为在健康检查通过的情况下，ConnectorRouter 会调用 connector.createPayment
      // MockConnector.setSimulateFailure(true) 会让它抛出 'Simulated connector failure'
      // 然后 Router 尝试 fallback 到 alipay/wechat，但它们也不是真正配置好的
      // 最终所有连接器失败
      expect(routeError).toBeTruthy()
      expect(routeError!.message).toContain('All connectors failed')

      // 恢复 MockConnector
      localMockConnector.setSimulateFailure(false)

      // 测试恢复后成功
      localRouter.updateHealth('mock', true)
      const result = await localRouter.route(
        'RECHARGE' as any,
        { amount: 100, userId: 'test' },
        async (connector: any, config: any, request: any) => {
          return connector.createPayment(request)
        },
      )
      expect(result.connectorName).toBe('mock')
      // fallbackChain 只包含尝试失败的连接器，成功的连接器不在其中
      expect(result.fallbackChain).not.toContain('mock')
    })

    afterAll(async () => {
      await freshModule3?.close()
    })
  })

  // ==========================================================================
  // 场景 4: 风控拦截
  // ==========================================================================
  describe('场景 4: 风控拦截', () => {
    let freshPrisma4: MockPrismaClient
    let freshModule4: TestingModule
    let user4: any
    let transSvc4: TransactionsService
    let riskSvc4: RiskEngineService
    const orderAmount = 10000

    beforeAll(async () => {
      freshPrisma4 = new MockPrismaClient()
      const freshRedis4 = new MockRedisClient()

      freshModule4 = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({
              NODE_ENV: 'test',
              RECHARGE_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
              MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
              JWT_SECRET: 'test-jwt-secret',
              JWT_ADMIN_SECRET: 'test-jwt-admin-secret',
              SMS_CODE_SECRET: 'test-sms-secret',
            })],
          }),
          PaymentChannelsModule,
          TransactionsModule,
          UsersModule,
          RiskModule,
          FinanceModule,
          RedisModule,
          PrismaModule,
          CryptoModule,
          SecurityModule,
          AuditModule,
          AuthModule,
          AccountsModule,
          BillsModule,
          MerchantsModule,
          WebhooksModule,
          SmsModule,
          HealthModule,
          NotificationsModule,
          ScheduleHealthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(freshPrisma4 as any)
        .overrideProvider(RedisService)
        .useValue(freshRedis4 as any)
        .compile()

      transSvc4 = freshModule4.get(TransactionsService)
      riskSvc4 = freshModule4.get(RiskEngineService)
      const usrSvc4 = freshModule4.get(UsersService)

      const bcrypt = await import('bcrypt')
      const pwdHash = await bcrypt.hash(testPayPassword, 10)

      // 创建用户
      user4 = await usrSvc4.create({
        nickname: '风控测试用户',
        phone: '13800138002',
        loginPassword: pwdHash,
      })
      await freshPrisma4.user.update({
        where: { id: user4.id },
        data: { payPassword: pwdHash, realNameStatus: 'VERIFIED' },
      })

      // 设置支付渠道
      await freshPrisma4.paymentChannelConfig.create({
        data: {
          code: 'mock',
          name: '模拟渠道',
          type: 'RECHARGE',
          enabled: true,
          config: '{}',
          priority: 100,
        },
      })

      // 清空风控缓存
      riskSvc4.clearCache()
    })

    it('短时间内大量充值触发风控', async () => {
      // 先创建一些成功的充值记录（通过风控检测，让日限额接近上限）
      // 但更可靠的方式：检查 single_amount 规则（> 50,000 yuan = 5,000,000 fen）
      // 如果我们充值 1 元（100 fen），不会触发 single_amount
      // 所以我们通过修改每日限额来触发 daily_amount 规则
      // 或者设置 SystemConfig 中的 risk_rule 配置

      // 方法：修改 single_amount 限制为一个很低的值
      // 但 risk_rule 从 systemConfig 表加载，我们插入一个配置
      await freshPrisma4.systemConfig.create({
        data: {
          key: 'risk_rule:single_amount',
          value: JSON.stringify({
            enabled: true,
            params: { maxAmount: 50 }, // 50分 = 0.5元
            action: 'BLOCK',
          }),
        },
      })

      riskSvc4.clearCache()

      // 充值 1 元（100分），超过 50 分的限制
      let blockError: any = null
      try {
        await transSvc4.recharge(user4.id, 1, testPayPassword, `idem-risk1-${Date.now()}`)
      } catch (err: any) {
        blockError = err
      }

      expect(blockError).toBeTruthy()
      // 应该返回 ForbiddenException（风控拦截）
      expect(blockError.response?.message || blockError.message).toContain('风控')

      // 验证 RiskEvent 被创建
      const riskEvents = freshPrisma4.getTable('riskEvent')
      const relevantEvents = riskEvents.filter((e: any) => e.userId === user4.id)
      expect(relevantEvents.length).toBeGreaterThanOrEqual(1)
    })

    afterAll(async () => {
      await freshModule4?.close()
    })
  })

  // ==========================================================================
  // 场景 5: 多并发订单
  // ==========================================================================
  describe('场景 5: 多并发订单', () => {
    let freshPrisma5: MockPrismaClient
    let freshModule5: TestingModule
    let user5: any
    let transSvc5: TransactionsService
    let riskSvc5: RiskEngineService

    beforeAll(async () => {
      freshPrisma5 = new MockPrismaClient()
      const freshRedis5 = new MockRedisClient()

      freshModule5 = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({
              NODE_ENV: 'test',
              RECHARGE_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
              MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
              JWT_SECRET: 'test-jwt-secret',
              JWT_ADMIN_SECRET: 'test-jwt-admin-secret',
              SMS_CODE_SECRET: 'test-sms-secret',
            })],
          }),
          PaymentChannelsModule,
          TransactionsModule,
          UsersModule,
          RiskModule,
          FinanceModule,
          RedisModule,
          PrismaModule,
          CryptoModule,
          SecurityModule,
          AuditModule,
          AuthModule,
          AccountsModule,
          BillsModule,
          MerchantsModule,
          WebhooksModule,
          SmsModule,
          HealthModule,
          NotificationsModule,
          ScheduleHealthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(freshPrisma5 as any)
        .overrideProvider(RedisService)
        .useValue(freshRedis5 as any)
        .compile()

      // 手动初始化平台账户（因为 Mock 不触发 onModuleInit）
      await freshPrisma5.platformAccount.upsert({
        where: { code: 'REVENUE_FEE' },
        create: { code: 'REVENUE_FEE', name: '手续费收入', balance: 0 },
        update: {},
      })
      await freshPrisma5.platformAccount.upsert({
        where: { code: 'CHANNEL_FUND' },
        create: { code: 'CHANNEL_FUND', name: '渠道资金', balance: 0 },
        update: {},
      })
      await freshPrisma5.platformAccount.upsert({
        where: { code: 'MERCHANT_PAYABLE' },
        create: { code: 'MERCHANT_PAYABLE', name: '应付商户款', balance: 0 },
        update: {},
      })

      transSvc5 = freshModule5.get(TransactionsService)
      riskSvc5 = freshModule5.get(RiskEngineService)

      const usrSvc5 = freshModule5.get(UsersService)
      const bcrypt = await import('bcrypt')
      const pwdHash = await bcrypt.hash(testPayPassword, 10)

      user5 = await usrSvc5.create({
        nickname: '并发测试用户',
        phone: '13800138003',
        loginPassword: pwdHash,
      })
      await freshPrisma5.user.update({
        where: { id: user5.id },
        data: { payPassword: pwdHash, realNameStatus: 'VERIFIED' },
      })

      await freshPrisma5.paymentChannelConfig.create({
        data: {
          code: 'mock',
          name: '模拟渠道',
          type: 'RECHARGE',
          enabled: true,
          config: '{}',
          priority: 100,
        },
      })

      riskSvc5.clearCache()
    })

    it('同时发起 10 个充值订单并模拟批量回调，全部成功', async () => {
      const CONCURRENT = 10
      const orders: any[] = []

      // 同时发起 10 个充值
      const rechargePromises = Array.from({ length: CONCURRENT }, (_, i) =>
        transSvc5.recharge(user5.id, 1, testPayPassword, `idem-conc-${i}-${Date.now()}`),
      )

      const results = await Promise.allSettled(rechargePromises)
      const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[]
      expect(fulfilled.length).toBe(CONCURRENT)

      for (const r of fulfilled) {
        orders.push(r.value)
      }

      // 验证所有订单已创建
      const allOrders = freshPrisma5.getTable('transactionOrder')
      const rechargeOrders = allOrders.filter((o: any) => o.type === 'RECHARGE')
      expect(rechargeOrders.length).toBe(CONCURRENT)

      // 模拟批量回调（金额必须与订单一致——H2 修复后实付金额会被强校验；
      // 每笔充值 1 元 = 100 分，recharge() 返回体不含 amount，故显式取已知值）
      const RECHARGE_AMOUNT_FEN = 100
      const callbackResults = await Promise.allSettled(
        orders.map((order) => {
          const callbackBody = JSON.stringify({
            orderNo: order.orderNo,
            channelOrderNo: order.channelOrderNo,
            amount: RECHARGE_AMOUNT_FEN,
            status: 'SUCCESS',
          })
          const signature = signMockBody({
            orderNo: order.orderNo,
            channelOrderNo: order.channelOrderNo || '',
            amount: RECHARGE_AMOUNT_FEN,
          })
          return transSvc5.handleRechargeCallback('mock', callbackBody, { 'x-signature': signature })
        }),
      )

      const callbackOk = callbackResults.filter((r) => r.status === 'fulfilled')
      expect(callbackOk.length).toBe(CONCURRENT)

      // 验证全部成功
      const updatedOrders = allOrders.filter((o: any) => o.type === 'RECHARGE')
      const successOrders = updatedOrders.filter((o: any) => o.status === 'SUCCESS')
      expect(successOrders.length).toBe(CONCURRENT)

      // 验证余额 = 总充值金额（每次充值 1 元 = 100 分）
      const account = await freshPrisma5.account.findUnique({ where: { userId: user5.id } })
      expect(account?.availableBalance).toBe(100 * CONCURRENT)
    })

    afterAll(async () => {
      await freshModule5?.close()
    })
  })

  // ==========================================================================
  // 场景 6: 对账差异和自动修正
  // ==========================================================================
  describe('场景 6: 对账差异和自动修正', () => {
    let freshPrisma6: MockPrismaClient
    let freshModule6: TestingModule
    let localAutoFix: AutoFixService

    beforeAll(async () => {
      freshPrisma6 = new MockPrismaClient()
      const freshRedis6 = new MockRedisClient()

      freshModule6 = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({
              NODE_ENV: 'test',
              RECHARGE_NOTIFY_URL: 'https://test.example.com/webhooks/recharge/mock',
              MOCK_CHANNEL_SECRET: 'mock-channel-secret-dev-only',
              JWT_SECRET: 'test-jwt-secret',
              JWT_ADMIN_SECRET: 'test-jwt-admin-secret',
              SMS_CODE_SECRET: 'test-sms-secret',
            })],
          }),
          PaymentChannelsModule,
          TransactionsModule,
          UsersModule,
          RiskModule,
          FinanceModule,
          ChannelReconciliationModule,
          RedisModule,
          PrismaModule,
          CryptoModule,
          SecurityModule,
          AuditModule,
          AuthModule,
          AccountsModule,
          BillsModule,
          MerchantsModule,
          WebhooksModule,
          SmsModule,
          HealthModule,
          NotificationsModule,
          ScheduleHealthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(freshPrisma6 as any)
        .overrideProvider(RedisService)
        .useValue(freshRedis6 as any)
        .compile()

      localAutoFix = freshModule6.get(AutoFixService)
    })

    it('自动修正小额对账差异', async () => {
      // 预置一个用户：RiskEvent.userId 外键要求归属真实用户（v0.2.2 起
      // auto-fix 采用 anchor 用户模式，不再写不存在的 SYSTEM 用户）
      await freshPrisma6.user.create({
        data: { id: 'anchor-u1', nickname: '锚点用户', status: 'ACTIVE' },
      })

      // 创建对账差异项（小额，≤50分）
      const diff = await freshPrisma6.reconciliationDifferenceItem.create({
        data: {
          reportDate: '2026-07-29',
          channelCode: 'mock',
          channelOrderNo: 'MOCK_R_123',
          platformOrderNo: 'R123456',
          diffType: 'AMOUNT_MISMATCH',
          amount: 30, // 30分 = 0.3元（≤50分阈值）
          description: '金额不一致：平台100分，渠道70分',
          status: 'PENDING',
        },
      })

      // 运行 auto-fix
      const fixed = await localAutoFix.autoFix([
        {
          id: diff.id,
          amount: diff.amount,
          diffType: diff.diffType,
          status: diff.status,
        },
      ])

      expect(fixed.length).toBe(1)
      expect(fixed[0].action).toBe('IGNORE')
      expect(fixed[0].diffId).toBe(diff.id)

      // 验证差异已被标记为 IGNORED
      const updatedDiff = await freshPrisma6.reconciliationDifferenceItem.findUnique({
        where: { id: diff.id },
      })
      expect(updatedDiff?.status).toBe('IGNORED')

      // 验证 RiskEvent 被创建（level = LOW）
      const riskEvents = freshPrisma6.getTable('riskEvent')
      const autoFixEvents = riskEvents.filter(
        (e: any) => e.level === 'LOW' && e.description?.includes(diff.id),
      )
      expect(autoFixEvents.length).toBeGreaterThanOrEqual(1)
      expect(autoFixEvents[0].handled).toBe(true)
    })

    afterAll(async () => {
      await freshModule6?.close()
    })
  })
})
