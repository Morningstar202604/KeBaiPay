import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ConnectorRegistry } from './connector.registry'
import { ConnectorRouter } from './connector-router'
import { ConnectorStatus, ConnectorHealth } from './connector.interface'

/**
 * 健康检查记录
 */
interface HealthRecord {
  healthy: boolean
  consecutiveFailures: number
  totalChecks: number
  lastLatency: number
  lastChecked: Date
  lastError?: string
}

/**
 * 连接器健康检查服务
 *
 * 功能：
 * - 定时轮询所有已注册连接器
 * - 3 次连续失败标记 DEGRADED
 * - 恢复后自动标记 ACTIVE
 * - 更新健康状态到路由器缓存
 */
@Injectable()
export class ConnectorHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectorHealthService.name)
  private readonly records = new Map<string, HealthRecord>()

  private readonly DEGRADED_THRESHOLD = 3
  private readonly RECOVERY_THRESHOLD = 2
  private readonly TIMEOUT_MS = 10_000

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly router: ConnectorRouter,
  ) {}

  /**
   * 执行指定连接器的健康检查
   */
  async checkConnector(name: string): Promise<ConnectorHealth> {
    const connector = this.registry.get(name)
    if (!connector) {
      throw new Error(`Connector not found: ${name}`)
    }

    const startTime = Date.now()
    let health: ConnectorHealth

    try {
      const timeoutPromise = this.sleep(this.TIMEOUT_MS).then(() => {
        throw new Error(`Health check timeout for ${name} after ${this.TIMEOUT_MS}ms`)
      })
      health = await Promise.race([connector.healthCheck(), timeoutPromise])
    } catch (error) {
      const latency = Date.now() - startTime
      health = {
        status: 'DEGRADED',
        lastChecked: new Date(),
        latency,
        errorRate: 1,
        errorMessage: error instanceof Error ? error.message : 'Health check failed',
      }
    }

    this.updateRecord(name, health)
    this.router.updateHealth(name, health.status === 'ACTIVE')

    return health
  }

  /**
   * 轮询所有注册连接器
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollAllConnectors(): Promise<void> {
    const connectors = this.registry.getAll()

    if (connectors.length === 0) return

    this.logger.debug(`开始健康检查轮询，共 ${connectors.length} 个连接器`)

    const results = await Promise.allSettled(
      connectors.map((c) => this.checkConnector(c.metadata.name)),
    )

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(`健康检查异常: ${result.reason}`)
      }
    }
  }

  /**
   * 获取连接器健康状态
   */
  getHealth(name: string): HealthRecord | undefined {
    return this.records.get(name)
  }

  /**
   * 获取所有连接器健康状态
   */
  getAllHealth(): Array<{ name: string; record: HealthRecord }> {
    return Array.from(this.records.entries()).map(([name, record]) => ({
      name,
      record,
    }))
  }

  /**
   * 获取健康摘要
   */
  getHealthSummary(): {
    total: number
    active: number
    degraded: number
    inactive: number
  } {
    const connectors = this.registry.getAll()
    let active = 0
    let degraded = 0
    let inactive = 0

    for (const c of connectors) {
      const record = this.records.get(c.metadata.name)
      if (!record || record.healthy) {
        active++
      } else if (record.consecutiveFailures >= this.DEGRADED_THRESHOLD) {
        degraded++
      } else {
        inactive++
      }
    }

    return { total: connectors.length, active, degraded, inactive }
  }

  private updateRecord(name: string, health: ConnectorHealth): void {
    const existing = this.records.get(name)
    const isHealthy = health.status === 'ACTIVE'

    const record: HealthRecord = {
      healthy: isHealthy,
      consecutiveFailures: isHealthy ? 0 : (existing?.consecutiveFailures ?? 0) + 1,
      totalChecks: (existing?.totalChecks ?? 0) + 1,
      lastLatency: health.latency,
      lastChecked: health.lastChecked,
      lastError: health.errorMessage,
    }

    this.records.set(name, record)

    if (record.consecutiveFailures >= this.DEGRADED_THRESHOLD) {
      this.logger.warn(
        `连接器 ${name} 连续 ${record.consecutiveFailures} 次失败，标记为 DEGRADED`,
      )
    }

    if (isHealthy && existing && !existing.healthy) {
      this.logger.log(`连接器 ${name} 已恢复 ACTIVE`)
    }
  }

  onModuleDestroy(): void {
    // ScheduleModule manages cron lifecycle; this method ensures
    // the interface contract is honored so Jest can detect no open handles
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms).unref())
  }
}
