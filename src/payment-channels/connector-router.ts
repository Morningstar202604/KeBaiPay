import { Injectable, Logger } from '@nestjs/common'
import { ConnectorRegistry } from './connector.registry'
import {
  Connector,
  ConnectorCapability,
  ConnectorConfig,
} from './connector.interface'

/**
 * 路由结果
 */
export interface RouteResult<R = any> {
  connectorName: string
  result: R
  fallbackChain: string[]
}

/**
 * 重试策略
 */
export interface RetryPolicy {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 200,
  maxDelayMs: 2000,
}

/** 路由选项 */
export interface RouteOptions {
  /**
   * 仅路由到指定连接器（按 metadata.name 精确匹配）。
   * 渠道选择已由上层（PaymentChannelRegistry）完成时使用，禁止跨渠道降级。
   */
  preferredName?: string
}

/**
 * 连接器智能路由
 *
 * 参考 Hyperswitch router 设计：
 * - 按能力 + 优先级 + 可用性路由请求
 * - 失败降级到次优先级的同能力连接器
 * - 可配置指数退避重试
 */
@Injectable()
export class ConnectorRouter {
  private readonly logger = new Logger(ConnectorRouter.name)
  private healthCache = new Map<string, { healthy: boolean; checkedAt: number }>()

  constructor(private readonly registry: ConnectorRegistry) {}

  /**
   * 路由请求：按能力、优先级路由到最优连接器
   *
   * @param capability 所需能力
   * @param request 请求体
   * @param requestFn 实际调用连接器的方法
   * @param retryPolicy 重试策略（可选，默认 2 次重试）
   * @param options 路由选项（可选，如 preferredName 指定唯一连接器）
   */
  async route<P, R>(
    capability: ConnectorCapability,
    request: P,
    requestFn: (connector: Connector<P, R>, config: ConnectorConfig, request: P) => Promise<R>,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
    options: RouteOptions = {},
  ): Promise<RouteResult<R>> {
    let candidates = this.registry.getByCapability(capability)

    // 指定 preferredName 时只考虑该连接器，不做跨渠道降级
    if (options.preferredName) {
      candidates = candidates.filter((c) => c.metadata.name === options.preferredName)
    }

    if (candidates.length === 0) {
      throw new Error(
        options.preferredName
          ? `No connector available for capability: ${capability} (preferred: ${options.preferredName})`
          : `No connector available for capability: ${capability}`,
      )
    }

    const fallbackChain: string[] = []

    for (const connector of candidates) {
      const name = connector.metadata.name
      const config = connector.getConfig()

      // 跳过健康检查失败的连接器
      if (!this.isHealthy(name)) {
        this.logger.warn(`连接器 ${name} 健康检查未通过，跳过`)
        fallbackChain.push(name)
        continue
      }

      try {
        const result = await this.executeWithRetry(
          connector,
          config,
          request,
          requestFn,
          retryPolicy,
        )
        return { connectorName: name, result, fallbackChain }
      } catch (error) {
        this.logger.warn(
          `连接器 ${name} 调用失败: ${error instanceof Error ? error.message : 'unknown'}，尝试降级`,
        )
        fallbackChain.push(name)
        // 继续下一个候选
      }
    }

    throw new Error(
      `All connectors failed for capability ${capability}. Fallback chain: [${fallbackChain.join(' -> ')}]`,
    )
  }

  /**
   * 刷新健康缓存
   */
  updateHealth(name: string, healthy: boolean): void {
    this.healthCache.set(name, {
      healthy,
      checkedAt: Date.now(),
    })
  }

  /**
   * 获取当前健康状态
   */
  isHealthy(name: string): boolean {
    const cached = this.healthCache.get(name)
    if (!cached) return true // 默认健康
    // 缓存超过 60 秒则重新检查
    if (Date.now() - cached.checkedAt > 60_000) return true
    return cached.healthy
  }

  /**
   * 带指数退避的重试执行
   *
   * P0-5：仅当请求携带幂等键时才允许自动重试。create 类外呼（下单/代付/退款）
   * 在渠道侧无幂等键保护时，超时重试可能造成渠道双下单/双放款——此前对任何错误
   * 盲目重试与 bridge 层"幂等键保证不重复扣款"的注释不符。
   * 判定依据：请求对象上 idempotencyKey / orderNo / refundNo 任一非空
   * （微信 out_batch_no、支付宝 out_biz_no/out_request_no、Stripe Idempotency-Key
   * 均以我方单号作为渠道侧幂等键，见各 connector 实现）。
   */
  private async executeWithRetry<P, R>(
    connector: Connector<P, R>,
    config: ConnectorConfig,
    request: P,
    requestFn: (connector: Connector<P, R>, config: ConnectorConfig, request: P) => Promise<R>,
    retryPolicy: RetryPolicy,
  ): Promise<R> {
    const { maxRetries, baseDelayMs, maxDelayMs } = retryPolicy
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn(connector, config, request)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < maxRetries) {
          if (!this.canSafelyRetry(request)) {
            this.logger.warn(
              `连接器 ${connector.metadata.name} 请求未携带幂等键，禁止自动重试（防止渠道双下单），直接失败`,
            )
            throw lastError
          }
          const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs)
          this.logger.warn(
            `重试 ${connector.metadata.name} 第 ${attempt + 1}/${maxRetries} 次，等待 ${delay}ms`,
          )
          await this.sleep(delay)
        }
      }
    }

    throw lastError!
  }

  /**
   * 判定请求是否可安全重试：必须携带明确的幂等键
   */
  private canSafelyRetry(request: unknown): boolean {
    if (!request || typeof request !== 'object') return false
    const r = request as Record<string, unknown>
    const hasKey = (v: unknown): boolean => typeof v === 'string' && v !== ''
    return hasKey(r.idempotencyKey) || hasKey(r.orderNo) || hasKey(r.refundNo)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
