import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { BatchTransferStatus } from '../common/enums'
import { RedisService } from '../redis/redis.service'
import { ScheduleHealthService } from '../common/schedule-health.service'
import { BatchTransfersService } from './batch-transfers.service'

/** 批量转账崩溃恢复：超过该时长的 PROCESSING 批次视为可能中断 */
const RECOVERY_DELAY_MS = 5 * 60 * 1000

/**
 * 批量转账中断恢复调度。
 * 逐笔在独立事务处理，进程崩溃会导致批次停留在 PROCESSING、明细停留在 PENDING。
 * 定时扫描并重放未处理明细（processItem 以 PENDING 为幂等守卫，安全重放）。
 */
@Injectable()
export class BatchTransfersSchedule {
  private readonly logger = new Logger(BatchTransfersSchedule.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly batchTransfersService: BatchTransfersService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('batch-transfers:recover', CronExpression.EVERY_5_MINUTES, '批量转账中断恢复（重放 PROCESSING 未完成明细）')
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverStuckBatches() {
    const started = Date.now()
    this.scheduleHealth.reportStart('batch-transfers:recover')
    try {
      const cutoff = new Date(Date.now() - RECOVERY_DELAY_MS)
      const stuck = await this.prisma.batchTransfer.findMany({
        where: { status: BatchTransferStatus.PROCESSING, updatedAt: { lt: cutoff } },
      })
      for (const batch of stuck) {
        // 不再跳过无 PENDING 明细的批次：明细全部终态但收尾未提交（崩溃窗口）的
        // 批次也要进入 resumeProcessing 收尾，否则冻结资金永久滞留（详见 service 内注释）
        await this.redis.withLock(`batch:recover:${batch.id}`, 60, () =>
          this.batchTransfersService.resumeProcessing(batch.id),
        )
        this.logger.log(`批量转账恢复完成: ${batch.batchNo}`)
      }
      this.scheduleHealth.reportComplete('batch-transfers:recover', true, Date.now() - started)
    } catch (err) {
      this.scheduleHealth.reportComplete('batch-transfers:recover', false, Date.now() - started, err instanceof Error ? err.message : String(err))
      throw err
    }
  }
}
