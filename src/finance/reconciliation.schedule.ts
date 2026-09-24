import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  RiskEventType,
  RiskLevel,
  ReconciliationStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { FinanceService } from './finance.service'
import { ReconciliationService } from './reconciliation.service'
import {buildLockKey, DAY_MS} from '../common/constants'
import { businessDayKey } from '../common/date-helpers'
import { ScheduleHealthService } from '../common/schedule-health.service'

// 补跑窗口：最近多少天检查缺失的对账/快照
const BACKFILL_DAYS = 7
// 调度互斥锁 TTL：5 分钟，保证多实例部署时同一时刻仅一个实例执行对账调度
const SCHED_LOCK_TTL_SECONDS = 5 * 60
// 对账差异描述中的字段
interface ReconciliationDifference {
  message?: string
  check?: string
  [key: string]: unknown
}

@Injectable()
export class ReconciliationSchedule {
  private readonly logger = new Logger(ReconciliationSchedule.name)

  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly financeService: FinanceService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('finance:reconciliation', '0 2 * * *', '每日对账')
  }

  // 每天凌晨 2 点对前一天的数据进行对账，并补跑最近 7 天缺失的对账与快照
  @Cron('0 2 * * *')
  async runReconciliation() {
    const start = Date.now()
    const yesterday = this.formatDate(new Date(Date.now() - DAY_MS))

    this.scheduleHealth.reportStart('finance:reconciliation')

    // 多实例部署时通过分布式锁串行化，拿不到锁则跳过，避免并发执行对账
    if (!this.redis.isEnabled()) {
      await this.executeReconciliation(yesterday, start)
      return
    }
    try {
      await this.redis.withLock(buildLockKey('sched:reconcile', yesterday),
        SCHED_LOCK_TTL_SECONDS,
        async () => {
          await this.executeReconciliation(yesterday, start)
        },
      )
    } catch (err) {
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete(
        'finance:reconciliation',
        false,
        duration,
        err instanceof Error ? err.message : String(err),
      )
      // 未获取到锁（其他实例正在执行）静默跳过
      this.logger.debug(
        `对账调度本轮跳过：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async executeReconciliation(yesterday: string, start: number) {
    try {
      // 任务5：先补跑缺失的 DailySnapshot（最近 7 天）
      await this.backfillDailySnapshots()

      // 任务5：补跑缺失的 ReconciliationReport（最近 7 天）
      // yesterday 也在 7 天窗口内，会被自动覆盖，无需单独再跑一次
      await this.backfillReconciliations()

      // 兜底：确保 yesterday 的对账一定被执行过（即使 7 天窗口逻辑有遗漏）
      const existing = await this.prisma.reconciliationReport.findUnique({
        where: { date: yesterday },
      })
      if (!existing) {
        const report = await this.reconciliationService.runReconciliation(
          yesterday,
        )
        this.logger.log(
          `已完成 ${yesterday} 对账，状态：${report.status}`,
        )
        await this.maybeAlertReconciliationFailure(yesterday, { status: report.status as ReconciliationStatus, differences: report.differences })
      }

      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('finance:reconciliation', true, duration)
      this.logger.log(`对账任务完成，耗时 ${duration}ms`)
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('finance:reconciliation', false, duration, message)
      this.logger.error(`执行 ${yesterday} 对账失败`, err)
      throw err
    }
  }

  // 任务5：补跑最近 7 天缺失的 DailySnapshot
  private async backfillDailySnapshots(): Promise<void> {
    const dates = this.getRecentDates(BACKFILL_DAYS)
    for (const date of dates) {
      try {
        const existing = await this.prisma.dailySnapshot.findUnique({
          where: { date },
        })
        if (existing) continue
        await this.financeService.generateDailySnapshot(date)
        this.logger.log(`补生成 ${date} 财务快照成功`)
      } catch (err) {
        this.logger.error(`补生成 ${date} 财务快照失败`, err)
      }
    }
  }

  // 任务5：补跑最近 7 天缺失的 ReconciliationReport
  private async backfillReconciliations(): Promise<void> {
    const dates = this.getRecentDates(BACKFILL_DAYS)
    for (const date of dates) {
      try {
        const existing = await this.prisma.reconciliationReport.findUnique({
          where: { date },
        })
        if (existing) continue
        const report = await this.reconciliationService.runReconciliation(date)
        this.logger.log(`补跑 ${date} 对账完成，状态：${report.status}`)
        await this.maybeAlertReconciliationFailure(date, { status: report.status as ReconciliationStatus, differences: report.differences })
      } catch (err) {
        this.logger.error(`补跑 ${date} 对账失败`, err)
      }
    }
  }

  // 任务3：对账失败（status=FAILED 或有差异）时创建 RiskEvent 告警
  // 直接通过 PrismaService 创建，不依赖 RiskEngineService
  private async maybeAlertReconciliationFailure(
    date: string,
    report: {
      status: ReconciliationStatus
      differences: string | null
    },
  ): Promise<void> {
    const hasDifferences =
      report.differences !== null && report.differences.length > 0
    const isFailed =
      report.status === ReconciliationStatus.FAILED || hasDifferences
    if (!isFailed) return

    let diffMessages = ''
    if (report.differences) {
      try {
        const diffs = JSON.parse(report.differences) as ReconciliationDifference[]
        diffMessages = diffs
          .map((d) => d.message || d.check || JSON.stringify(d))
          .join(', ')
      } catch {
        diffMessages = report.differences
      }
    }

    // P2 修复：告警改写入 adminOperationLog（adminId 无外键约束，可用 'system' 占位），
    // 旧实现写 riskEvent.userId='system' 会命中 User 外键约束必然失败，
    // 被 catch 吞掉导致所有 HIGH 级对账差异告警静默丢失
    try {
      await this.prisma.adminOperationLog.create({
        data: {
          adminId: 'system',
          action: 'RECONCILE_ALERT',
          target: date,
          detail: `对账差异: ${diffMessages}`,
        },
      })
      this.logger.warn(`对账 ${date} 失败已创建风控告警`)
    } catch (err) {
      this.logger.error(`对账 ${date} 风控告警创建失败`, err)
    }
  }

  private getRecentDates(days: number): string[] {
    const result: string[] = []
    const today = new Date()
    for (let i = 1; i <= days; i++) {
      const d = new Date(today.getTime() - i * DAY_MS)
      result.push(this.formatDate(d))
    }
    return result.sort()
  }

  private formatDate(date: Date): string {
    // 业务日口径（北京时间）：对账日切与限额/风控一致，避免 0:00-8:00 数据跨日错账
    return businessDayKey(date)
  }
}
