// bcrypt cost：10 约 60-80ms，12 约 250-300ms（2026 年硬件基线）。
// 提升只影响新哈希（cost 存于 hash 头，旧哈希校验不受影响），登录接口耗时相应增加属预期。
export const BCRYPT_SALT_ROUNDS = 12

/** 费率分母：万分之一 */
export const RATE_DENOMINATOR = 10000

/** 一天对应的毫秒数 */
export const DAY_MS = 24 * 60 * 60 * 1000

/** 订单默认过期时间：30 分钟 */
export const ORDER_EXPIRY_MS = 30 * 60 * 1000
/** 订单最大允许过期时间：24 小时 */
export const MAX_ORDER_EXPIRY_MS = DAY_MS

/** 支付密码错误锁定时间：15 分钟 */
export const PAY_PASSWORD_LOCK_MS = 15 * 60 * 1000
/** 支付密码最大尝试次数 */
export const MAX_PAY_PASSWORD_ATTEMPTS = 5

/** 认证接口限流：每 60 秒最多 5 次 */
export const AUTH_THROTTLE_LIMIT = 5
export const AUTH_THROTTLE_TTL_MS = 60 * 1000

/** 开放 API 限流：每 60 秒最多 30 次 */
export const OPEN_API_THROTTLE_LIMIT = 30
export const OPEN_API_THROTTLE_TTL_MS = 60 * 1000

/** 全局限流：每 60 秒最多 100 次 */
export const GLOBAL_THROTTLE_LIMIT = 100
export const GLOBAL_THROTTLE_TTL_MS = 60 * 1000

/** 默认分页 */
export const DEFAULT_PAGE_SIZE = 10
export const MAX_PAGE_SIZE = 100
export const BILL_LIST_LIMIT = 50
export const MAX_EXPORT_ROWS = 10000

/** Redis 分布式锁默认 TTL：30 秒 */
export const REDIS_LOCK_TTL_SECONDS = 30

/** 默认日限额（单位：分） */
export const DEFAULT_TRANSFER_DAILY_LIMIT_CENTS = 50000 * 100 // 5 万元
export const DEFAULT_PAYMENT_DAILY_LIMIT_CENTS = 5000000 // 5 万元
export const DEFAULT_MERCHANT_DAILY_LIMIT_CENTS = 10000000 // 10 万元

/** 商户回调通知 */
export const MAX_CALLBACK_RETRIES = 5
export const CALLBACK_TIMEOUT_MS = 10 * 1000
// 已付款但通知失败的订单，距 paidAt 超过该时长的进入补偿重试队列
export const NOTIFY_RETRY_BACKOFF_MS = 5 * 60 * 1000
// 单次补偿任务最多处理的订单数，防止积压时一次性打爆下游
export const NOTIFY_RETRY_BATCH_SIZE = 100

/** 商户看板时间跨度 */
export const DASHBOARD_WEEK_DAYS = 7
export const DASHBOARD_MONTH_DAYS = 30

/**
 * JWT token 类型声明（typ 字段），用于区分 user/admin token。
 * 即使运维误将 JWT_USER_SECRET 与 JWT_ADMIN_SECRET 设为相同值，
 * 也可通过 typ 校验防止 admin token 被当 user token 使用（反之亦然）。
 */
export const JWT_TOKEN_TYPE_USER = 'user'
export const JWT_TOKEN_TYPE_ADMIN = 'admin'
export const JWT_TOKEN_TYPE_AGENT = 'agent'

/**
 * Agent 场景类型：标识 Agent 用途，决定可用工具集
 * - wallet：C 端收单客户场景（历史命名，原"钱包管家"，现提供订单查询/账单等收单服务）
 * - merchant：B 端店长助理（创建订单、对账、退款等）
 * - risk：A 端风控审计官（事件处置、规则生成、巡检告警）
 * - support：通用客服坐席
 */
export const AGENT_SCENARIOS = ['wallet', 'merchant', 'risk', 'support'] as const
export type AgentScenario = (typeof AGENT_SCENARIOS)[number]

/**
 * Agent 操作结果枚举
 */
export const AGENT_RESULT_SUCCESS = 'SUCCESS'
export const AGENT_RESULT_FAILED = 'FAILED'
export const AGENT_RESULT_PENDING_CONFIRM = 'PENDING_CONFIRM'
export const AGENT_RESULT_REJECTED = 'REJECTED'
export const AGENT_RESULT_EXPIRED = 'EXPIRED'

/**
 * Agent 对话消息角色（OpenAI 风格）
 */
export const AGENT_ROLE_USER = 'USER'
export const AGENT_ROLE_ASSISTANT = 'ASSISTANT'
export const AGENT_ROLE_SYSTEM = 'SYSTEM'

/**
 * Agent 链式 hash 起始 hash（同 AdminOperationLog 的 GENESIS_HASH）
 */
export const AGENT_GENESIS_HASH = '0'.repeat(64)

/**
 * Agent 咨询锁 ID（用于并发安全写入 AgentOperationLog）
 */
export const AGENT_LOG_ADVISORY_LOCK_ID = 8832


/** 统一分布式锁键：kb:lock:<namespace>[:<id>]
 *  统一前缀避免与其他 Redis key（缓存/计数）撞名；所有业务锁必须经此生成 */
export function buildLockKey(namespace: string, id?: string): string {
  return id ? `kb:lock:${namespace}:${id}` : `kb:lock:${namespace}`
}
