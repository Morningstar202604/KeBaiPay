import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { RiskEngineService } from './risk-engine.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RedisService } from '../redis/redis.service.js'
import { RiskLevel, RiskEventType, PaymentOrderStatus } from '../common/enums.js'
import { DEFAULT_TRANSFER_DAILY_LIMIT_CENTS } from '../common/constants.js'

type PrismaMock = {
  systemConfig: { findMany: jest.Mock; findUnique: jest.Mock }
  paymentOrder: { count: jest.Mock; aggregate: jest.Mock }
  riskEvent: { create: jest.Mock }
}
type RedisMock = {
  isEnabled: jest.Mock
  slidingWindowCount: jest.Mock
  slidingWindowRecord: jest.Mock
}

// 默认单笔限额（分）：5 万元 = 5_000_000 分
const SINGLE_LIMIT = DEFAULT_TRANSFER_DAILY_LIMIT_CENTS
// 默认单日金额限额（分）：20 万元 = 20_000_000 分
const DAILY_AMOUNT_LIMIT = 200000 * 100
// 默认单日次数上限
const DAILY_COUNT_LIMIT = 50
// 默认频率窗口内最大次数
const FREQ_WINDOW_MAX = 10
// 默认 IP 频率窗口内最大次数
const IP_FREQ_WINDOW_MAX = 20

describe('RiskEngineService', () => {
  let service: RiskEngineService
  let prisma: PrismaMock
  let redis: RedisMock

  beforeEach(() => {
    prisma = {
      systemConfig: { findMany: jest.fn(), findUnique: jest.fn() },
      paymentOrder: { count: jest.fn(), aggregate: jest.fn() },
      riskEvent: { create: jest.fn().mockResolvedValue({}) },
    }
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      slidingWindowCount: jest.fn().mockResolvedValue(0),
      slidingWindowRecord: jest.fn().mockResolvedValue(undefined),
    }
    service = new RiskEngineService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    )
  })

  /**
   * 设置"无任何规则命中"的默认 mock，供各测试按需覆盖
   */
  const setupPassingMocks = (): void => {
    prisma.systemConfig.findMany.mockResolvedValue([])
    prisma.systemConfig.findUnique.mockResolvedValue(null)
    prisma.paymentOrder.count.mockResolvedValue(0)
    prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { amount: 0 } })
    // Redis 可用且滑动窗口计数为 0：frequency / ip_frequency 规则不拦截
    // ip_frequency 走 fail-closed，必须 mock Redis 可用
    redis.isEnabled.mockReturnValue(true)
    redis.slidingWindowCount.mockResolvedValue(0)
  }

  describe('check 风控检查', () => {
    it('无规则命中时放行，不创建风险事件', async () => {
      setupPassingMocks()

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
        ip: '1.2.3.4',
      })

      expect(result.passed).toBe(true)
      expect(result.blocked).toBe(false)
      expect(result.needsReview).toBe(false)
      expect(result.warnings).toEqual([])
      expect(prisma.riskEvent.create).not.toHaveBeenCalled()
    })

    it('SINGLE_LIMIT: 单笔金额超过限额时拦截并写入 LARGE_PAYMENT 事件', async () => {
      setupPassingMocks()

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: SINGLE_LIMIT + 1,
      })

      expect(result.passed).toBe(false)
      expect(result.blocked).toBe(true)
      expect(result.rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'single_amount', action: 'BLOCK' }),
        ]),
      )
      expect(prisma.riskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          type: RiskEventType.LARGE_PAYMENT,
          level: RiskLevel.HIGH,
          description: expect.stringContaining('单笔金额'),
        }),
      })
    })

    it('SINGLE_LIMIT 边界: 金额恰好等于限额时不拦截', async () => {
      setupPassingMocks()

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: SINGLE_LIMIT,
      })

      expect(result.passed).toBe(true)
      expect(result.blocked).toBe(false)
      expect(prisma.riskEvent.create).not.toHaveBeenCalled()
    })

    it('DAILY_LIMIT(次数): 单日交易次数达到上限时拦截', async () => {
      setupPassingMocks()
      // daily_count 使用 paymentOrder.count，返回 50 = 上限
      prisma.paymentOrder.count.mockResolvedValue(DAILY_COUNT_LIMIT)

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
      })

      expect(result.blocked).toBe(true)
      expect(result.rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'daily_count', action: 'BLOCK' }),
        ]),
      )
      // daily_count 不在 freqCodes 中，事件类型按 ctx.type 映射
      expect(prisma.riskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: RiskEventType.LARGE_PAYMENT,
        }),
      })
    })

    it('DAILY_LIMIT(金额): 单日累计金额 + 本次超过限额时拦截', async () => {
      setupPassingMocks()
      // 已用 19_999_000 分，本次 2000 分 → 20_001_000 > 20_000_000
      prisma.paymentOrder.aggregate.mockResolvedValue({
        _sum: { amount: DAILY_AMOUNT_LIMIT - 1000 },
      })

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 2000,
      })

      expect(result.blocked).toBe(true)
      expect(result.rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'daily_amount', action: 'BLOCK' }),
        ]),
      )
    })

    it('DAILY_LIMIT(金额) 边界: 累计 + 本次恰好等于限额时不拦截', async () => {
      setupPassingMocks()
      prisma.paymentOrder.aggregate.mockResolvedValue({
        _sum: { amount: DAILY_AMOUNT_LIMIT - 1000 },
      })

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
      })

      expect(result.passed).toBe(true)
      expect(result.blocked).toBe(false)
    })

    it('FREQUENT_TRANSACTION(高频告警): frequency 规则 WARN 不拦截但产生告警', async () => {
      // Redis 不可用 → frequency 走 DB count 回退
      setupPassingMocks()
      // 本测试需要 Redis 不可用以验证 DB count 回退路径
      redis.isEnabled.mockReturnValue(false)
      // count = 10 同时用于 daily_count(10 < 50 不触发) 和 frequency(10 >= 10 触发 WARN)
      prisma.paymentOrder.count.mockResolvedValue(FREQ_WINDOW_MAX)

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
      })

      // WARN 不拦截
      expect(result.passed).toBe(true)
      expect(result.blocked).toBe(false)
      // 但有告警(frequency 规则 message 格式: "N 秒内交易 X 次，超过阈值 Y")
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('秒内交易')
      expect(result.warnings[0]).toContain('超过阈值')
      // WARN 不创建风险事件
      expect(prisma.riskEvent.create).not.toHaveBeenCalled()
    })

    it('FREQUENT_TRANSACTION(IP高频): ip_frequency 规则 BLOCK 并生成 FREQUENT_TRANSACTION 事件', async () => {
      setupPassingMocks()
      // 滑动窗口 key 格式：risk:ipfreq:{ip}:{windowSeconds}
      redis.slidingWindowCount.mockImplementation((key: string) => {
        if (key.startsWith('risk:ipfreq:1.2.3.4:60')) return Promise.resolve(IP_FREQ_WINDOW_MAX)
        if (key.startsWith('risk:freq:')) return Promise.resolve(0)
        return Promise.resolve(0)
      })

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
        ip: '1.2.3.4',
      })

      expect(result.blocked).toBe(true)
      // ip_frequency 在 freqCodes 中 → 事件类型为 FREQUENT_TRANSACTION
      expect(prisma.riskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: RiskEventType.FREQUENT_TRANSACTION,
          level: RiskLevel.HIGH,
        }),
      })
    })

    it('IP_FREQUENCY fail-closed: Redis 不可用时抛错', async () => {
      setupPassingMocks()
      redis.isEnabled.mockReturnValue(false)

      await expect(
        service.check({
          userId: 'u1',
          type: 'PAYMENT',
          amount: 1000,
          ip: '1.2.3.4',
        }),
      ).rejects.toThrow(/Redis 不可用/)
    })

    it('BLACKLIST_IP: IP 命中黑名单时拦截', async () => {
      setupPassingMocks()
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'risk_rule:ip_blacklist',
        value: JSON.stringify(['1.2.3.4', '5.6.7.8']),
      })

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
        ip: '1.2.3.4',
      })

      expect(result.blocked).toBe(true)
      expect(result.rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'ip_blacklist', action: 'BLOCK' }),
        ]),
      )
      // ip_blacklist 不在 freqCodes 中 → 按 ctx.type 映射
      expect(prisma.riskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: RiskEventType.LARGE_PAYMENT,
        }),
      })
    })

    it('REFUND 类型拦截时事件类型仍映射为 LARGE_PAYMENT（收单/退款统一事件口径）', async () => {
      setupPassingMocks()

      const result = await service.check({
        userId: 'u1',
        type: 'REFUND',
        amount: SINGLE_LIMIT + 1,
      })

      expect(result.blocked).toBe(true)
      expect(prisma.riskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: RiskEventType.LARGE_PAYMENT,
        }),
      })
    })

    it('多规则同时命中 BLOCK 时描述拼接所有拦截规则名', async () => {
      setupPassingMocks()
      // 同时触发 single_amount(BLOCK) 和 ip_blacklist(BLOCK)
      prisma.systemConfig.findUnique.mockResolvedValue({
        key: 'risk_rule:ip_blacklist',
        value: JSON.stringify(['1.2.3.4']),
      })

      await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: SINGLE_LIMIT + 1,
        ip: '1.2.3.4',
      })

      expect(prisma.riskEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: expect.stringContaining('单笔金额'),
        }),
      })
      // 描述中应同时包含两个 BLOCK 规则名
      const desc = prisma.riskEvent.create.mock.calls[0][0].data.description as string
      expect(desc).toContain('IP 黑名单')
    })
  })

  describe('recordTransaction 频率记录', () => {
    it('Redis 可用时向用户频率与 IP 频率 ZSET 追加成员', async () => {
      // recordTransaction 调用 loadRules()，需 mock systemConfig.findMany 返回空数组（使用默认规则）
      prisma.systemConfig.findMany.mockResolvedValue([])
      redis.isEnabled.mockReturnValue(true)
      redis.slidingWindowRecord.mockResolvedValue(undefined)

      await service.recordTransaction({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
        ip: '1.2.3.4',
      })

      // 默认 frequency 与 ip_frequency 规则 windowSeconds=60，windowMs=60000
      expect(redis.slidingWindowRecord).toHaveBeenCalledWith(
        'risk:freq:u1:PAYMENT:60',
        60000,
        expect.any(String),
      )
      expect(redis.slidingWindowRecord).toHaveBeenCalledWith(
        'risk:ipfreq:1.2.3.4:60',
        60000,
        expect.any(String),
      )
    })

    it('Redis 不可用时不调用 slidingWindowRecord', async () => {
      redis.isEnabled.mockReturnValue(false)

      await service.recordTransaction({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
        ip: '1.2.3.4',
      })

      expect(redis.slidingWindowRecord).not.toHaveBeenCalled()
    })

    it('不带 ip 时只记录用户频率，不调用 IP 维度记录', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([])
      redis.isEnabled.mockReturnValue(true)

      await service.recordTransaction({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
        // 无 ip
      })

      expect(redis.slidingWindowRecord).toHaveBeenCalledWith(
        'risk:freq:u1:PAYMENT:60',
        60000,
        expect.any(String),
      )
      for (const call of redis.slidingWindowRecord.mock.calls) {
        expect(call[0]).not.toMatch(/^risk:ipfreq:/)
      }
    })

    it('不同窗口规则都应记录（自定义 120s 窗口）', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([
        {
          key: 'risk_rule:frequency',
          value: JSON.stringify({ params: { windowSeconds: 120, windowMaxCount: 20 } }),
        },
      ])
      redis.isEnabled.mockReturnValue(true)

      await service.recordTransaction({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 1000,
        ip: '1.2.3.4',
      })

      expect(redis.slidingWindowRecord).toHaveBeenCalledWith(
        'risk:freq:u1:PAYMENT:120',
        120000,
        expect.any(String),
      )
      expect(redis.slidingWindowRecord).toHaveBeenCalledWith(
        'risk:ipfreq:1.2.3.4:120',
        120000,
        expect.any(String),
      )
    })
  })

  describe('规则缓存', () => {
    it('缓存 TTL 内多次 check 不重复查询数据库', async () => {
      setupPassingMocks()

      await service.check({ userId: 'u1', type: 'PAYMENT', amount: 1000 })
      await service.check({ userId: 'u1', type: 'PAYMENT', amount: 1000 })

      expect(prisma.systemConfig.findMany).toHaveBeenCalledTimes(1)
    })

    it('clearCache 后重新从数据库加载规则', async () => {
      setupPassingMocks()

      await service.check({ userId: 'u1', type: 'PAYMENT', amount: 1000 })
      expect(prisma.systemConfig.findMany).toHaveBeenCalledTimes(1)

      service.clearCache()

      await service.check({ userId: 'u1', type: 'PAYMENT', amount: 1000 })
      expect(prisma.systemConfig.findMany).toHaveBeenCalledTimes(2)
    })
  })

  describe('listAllRules', () => {
    it('返回全部默认规则，含 SystemConfig 自定义覆盖(含已禁用)', async () => {
      prisma.systemConfig.findMany.mockResolvedValue([
        {
          key: 'risk_rule:single_amount',
          value: JSON.stringify({ enabled: false }),
        },
      ])

      const rules = await service.listAllRules()

      expect(rules).toHaveLength(6)
      const singleAmount = rules.find((r) => r.code === 'single_amount')
      expect(singleAmount).toBeDefined()
      expect(singleAmount?.enabled).toBe(false)
      expect(rules.some((r) => !r.enabled)).toBe(true)
    })
  })

  describe('风控日计数/日金额：paymentOrder 收单口径', () => {
    it('getDailyAmount 读 paymentOrder.aggregate：payerId + paidAt 当日 + PAID 状态', async () => {
      setupPassingMocks()
      const mockedSum = 1_500_000
      prisma.paymentOrder.aggregate.mockResolvedValue({ _sum: { amount: mockedSum } })

      const result = await service.check({
        userId: 'u1',
        type: 'PAYMENT',
        amount: 2000,
      })

      // 收单口径：按付款方 payerId + 当日 paidAt + 已支付订单金额合计
      expect(prisma.paymentOrder.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          _sum: { amount: true },
          where: expect.objectContaining({
            payerId: 'u1',
            status: PaymentOrderStatus.PAID,
            paidAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      )
      expect(result.blocked).toBe(false)
      expect(result.passed).toBe(true)

      prisma.paymentOrder.aggregate.mockResolvedValue({
        _sum: { amount: DAILY_AMOUNT_LIMIT - 1000 },
      })
      const nearLimit = await service.check({ userId: 'u1', type: 'PAYMENT', amount: 2000 })
      expect(nearLimit.blocked).toBe(true)
    })

    it('getDailyCount 读 paymentOrder.count：REFUND 类型统计 REFUNDED 状态', async () => {
      setupPassingMocks()
      prisma.paymentOrder.count.mockResolvedValue(42)

      const result = await service.check({
        userId: 'u1',
        type: 'REFUND',
        amount: 1000,
      })

      expect(prisma.paymentOrder.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            payerId: 'u1',
            status: PaymentOrderStatus.REFUNDED,
            paidAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      )
      // 42 < DAILY_COUNT_LIMIT(50) → 不拦截
      expect(result.blocked).toBe(false)
      expect(result.passed).toBe(true)
    })
  })
})
