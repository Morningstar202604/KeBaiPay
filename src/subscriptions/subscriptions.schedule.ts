import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SubscriptionsService } from './subscriptions.service'
import { RedisService } from '../redis/redis.service'
import { ScheduleHealthService } from '../common/schedule-health.service'

@Injectable()
export class SubscriptionsSchedule {
  private readonly logger = new Logger(SubscriptionsSchedule.name)

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
  ) {
    this.scheduleHealth.register(
      'subscriptions:auto-charge',
      '0 */5 * * * *',
      '订阅自动扣款：扫描 nextChargeAt 到期的订阅并扣款',
    )
  }

  /** 每 5 分钟扫描：到期订阅自动扣款（分布式锁串行化，防多实例重叠扣款） */
  @Cron('0 */5 * * * *')
  async autoCharge() {
    const start = Date.now()
    this.scheduleHealth.reportStart('subscriptions:auto-charge')
    try {
      await this.redis.withLock('sched:subscription:auto-charge', 240, () =>
        this.subscriptionsService.autoCharge(),
      )
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('subscriptions:auto-charge', true, duration)
    } catch (err) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      this.scheduleHealth.reportComplete(
        'subscriptions:auto-charge',
        false,
        duration,
        message,
      )
      this.logger.error('订阅自动扣款扫描异常', err)
    }
  }
}
