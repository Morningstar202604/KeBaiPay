// ============================================================================
// Connector 标准接口
//
// 参考 Hyperswitch connector 架构设计：
//   - 每个 connector 是一个有能力的支付通道实例
//   - 通过 capabilities 声明支持哪些操作
//   - 统一的 createPayment / queryPayment / refundPayment 入口
//   - 统一的 webhook 处理
//   - 内建健康检查
// ============================================================================

/** 连接器能力枚举 */
export type ConnectorCapability =
  | 'RECHARGE'
  | 'PAYOUT'
  | 'REFUND'
  | 'BALANCE_QUERY'
  | 'RECONCILIATION'

/** 连接器运行状态 */
export type ConnectorStatus = 'ACTIVE' | 'INACTIVE' | 'DEGRADED'

/** 连接器持久化配置（运行时可修改、热加载） */
export interface ConnectorConfig {
  name: string
  displayName: string
  capabilities: ConnectorCapability[]
  priority: number
  timeout: number
  retryConfig: {
    maxRetries: number
    baseDelayMs: number
    maxDelayMs: number
  }
  /** 渠道级配置（密钥、商户号等，运行时从 DB 加载） */
  credentials?: Record<string, string>
  [key: string]: unknown
}

/** 连接器元数据（不可变，编译期确定） */
export interface ConnectorMetadata {
  name: string
  displayName: string
  capabilities: ConnectorCapability[]
  supportedCurrencies: string[]
  supportedMethods: string[]
  version: string
}

/** 健康检查结果 */
export interface ConnectorHealth {
  status: ConnectorStatus
  lastChecked: Date
  latency: number
  /** 最近窗口内的错误率 0~1 */
  errorRate: number
  errorMessage?: string
}

/** 通用连接器接口 */
export interface Connector<P = any, R = any> {
  readonly metadata: ConnectorMetadata

  getConfig(): ConnectorConfig
  setConfig(config: Partial<ConnectorConfig>): void

  /** 创建支付（RECHARGE 能力） */
  createPayment(request: P): Promise<R & { connectorOrderId: string }>

  /** 查询支付状态 */
  queryPayment(connectorOrderId: string): Promise<R>

  /** 退款（REFUND 能力） */
  refundPayment(
    connectorOrderId: string,
    amount: number,
    reason?: string,
  ): Promise<any>

  /** 验证 Webhook 签名 */
  verifyWebhook(payload: string, headers: Record<string, string>): boolean

  /** 解析 Webhook 事件 */
  parseWebhookEvent(
    payload: string,
    headers: Record<string, string>,
  ): { event: string; data: any }

  /** 健康检查 */
  healthCheck(): Promise<ConnectorHealth>
}
