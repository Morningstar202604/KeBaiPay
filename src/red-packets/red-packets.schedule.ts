import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { RedPacketStatus } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { RedPacketsService } from './red-packets.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

/** 单轮扫描最多处理的红包数，防积压时无界装载（剩余的留给下一轮 cron） */
const EXPIRE_SCAN_TAKE = 200

@Injectable()
export class RedPacketsSchedule {
  private readonly logger = new Logger(RedPacketsSchedule.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redPacketsService: RedPacketsService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register('red-packets:expire', '0 */5 * * * *', '过期红包退回')
  }

  @Cron('0 */5 * * * *')
  async expireRedPackets() {
    const start = Date.now()
    this.scheduleHealth.reportStart('red-packets:expire')
    try {
      // 分布式锁串行化：多实例部署时防止并发扫描重复退回（三个资金调度任务的统一口径）
      const processed = await this.redis.withLock('sched:red-packet:expire', 240, async () => {
        const now = new Date()
        const pendingPackets = await this.prisma.redPacket.findMany({
          where: {
            status: { in: [RedPacketStatus.PENDING, RedPacketStatus.PARTIALLY_RECEIVED] },
            expiresAt: { lt: now },
          },
          take: EXPIRE_SCAN_TAKE,
        })

        if (pendingPackets.length === 0) {
          return { scanned: 0, failed: 0 }
        }

        let successCount = 0
        let failCount = 0
        for (const packet of pendingPackets) {
          try {
            await this.redPacketsService.expireReturn(packet.id)
            successCount++
            this.logger.log(`红包 ${packet.packetNo} 已过期退回`)
          } catch (err) {
            failCount++
            this.logger.error(`红包 ${packet.packetNo} 退回失败`, err)
          }
        }
        return { scanned: successCount + failCount, failed: failCount }
      })

      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('red-packets:expire', processed.failed === 0, duration)
      if (processed.scanned > 0) {
        this.logger.log(
          `红包过期扫描完成: 总计 ${processed.scanned}, 失败 ${processed.failed}, 耗时 ${duration}ms`,
        )
      } else {
        this.logger.debug(`红包过期扫描完成，无需处理，耗时 ${duration}ms`)
      }
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete('red-packets:expire', false, duration, message)
      this.logger.error('红包过期扫描异常', err)
    }
  }
}
