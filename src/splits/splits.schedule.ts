import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { SplitStatus, SplitItemStatus } from '../common/enums'
import { RedisService } from '../redis/redis.service'
import { ScheduleHealthService } from '../common/schedule-health.service'
import { SplitsService } from './splits.service'

/** 分账崩溃恢复：超过该时长的 PROCESSING 订单视为可能中断（给正常处理留出时间窗） */
const RECOVERY_DELAY_MS = 5 * 60 * 1000

/**
 * 分账中断恢复调度。
 * 分账逐笔在独立事务处理，进程崩溃会导致订单停留在 PROCESSING、明细停留在 PENDING。
 * 定时扫描并重放未处理明细（processSplitItem 以 PENDING 为幂等守卫，安全重放）。
 */
@Injectable()
export class SplitsSchedule {
  private readonly logger = new Logger(SplitsSchedule.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly splitsService: SplitsService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('splits:recover', CronExpression.EVERY_5_MINUTES, '分账中断恢复（重放 PROCESSING 未完成明细）')
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverStuckSplits() {
    const started = Date.now()
    this.scheduleHealth.reportStart('splits:recover')
    try {
      const cutoff = new Date(Date.now() - RECOVERY_DELAY_MS)
      const stuck = await this.prisma.splitOrder.findMany({
        where: { status: SplitStatus.PROCESSING, updatedAt: { lt: cutoff } },
        include: { items: { where: { status: SplitItemStatus.PENDING }, select: { id: true } } },
      })
      for (const split of stuck) {
        if (split.items.length === 0) continue
        await this.redis.withLock(`split:recover:${split.id}`, 60, () =>
          this.splitsService.resumeProcessing(split.id),
        )
        this.logger.log(`分账恢复完成: ${split.splitNo}`)
      }
      this.scheduleHealth.reportComplete('splits:recover', true, Date.now() - started)
    } catch (err) {
      this.scheduleHealth.reportComplete('splits:recover', false, Date.now() - started, err instanceof Error ? err.message : String(err))
      throw err
    }
  }
}
