import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { TransactionStatus, TransactionType } from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'
import { ScheduleHealthService } from '../common/schedule-health.service'
import { TransactionsService } from './transactions.service'
import { buildLockKey } from '../common/constants'

/** PENDING 状态超过该时长视为异常，需核实渠道真实状态 */
const PENDING_TIMEOUT_MS = 15 * 60 * 1000
/** 调度互斥锁 TTL：5 分钟（与 cron 周期一致，保证同一时刻仅一个实例执行） */
const SCHED_LOCK_TTL_SECONDS = 5 * 60

@Injectable()
export class TransactionsSchedule {
  private readonly logger = new Logger(TransactionsSchedule.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly scheduleHealth: ScheduleHealthService,
    private readonly transactionsService: TransactionsService,
  ) {
    this.scheduleHealth.register('transactions:rechargeTimeout', '0 */5 * * * *', '充值超时兜底扫描')
  }

  // 每 5 分钟扫描 PENDING 超过 15 分钟的充值订单：
  // - 有渠道单号：主动向渠道查单（reconcilePendingRecharge），渠道确认成功且金额一致则补单入账，
  //   渠道关闭/失败则置 FAILED；查单仍 PENDING 或失败则保持现状等下一轮。
  // - 无渠道单号：无法查单，仅告警待人工核实。
  // 防止渠道调用后进程崩溃导致订单永久卡在 PENDING、回调被拒、资金/订单状态不一致。
  @Cron('0 */5 * * * *')
  async handleRechargeTimeout() {
    const start = Date.now()
    this.scheduleHealth.reportStart('transactions:rechargeTimeout')
    if (!this.redis.isEnabled()) {
      // 无 Redis 的单实例环境（本地开发/测试）无多实例并发风险，直接执行
      await this.scanTimeoutOrders().catch((err) =>
        this.logger.error('充值超时兜底扫描失败', err),
      )
      this.scheduleHealth.reportComplete('transactions:rechargeTimeout', true, Date.now() - start)
      return
    }
    try {
      await this.redis.withLock(
        buildLockKey('sched:recharge:timeout'),
        SCHED_LOCK_TTL_SECONDS,
        async () => {
          await this.scanTimeoutOrders().catch((err) =>
            this.logger.error('充值超时兜底扫描失败', err),
          )
        },
      )
      this.scheduleHealth.reportComplete('transactions:rechargeTimeout', true, Date.now() - start)
    } catch (err) {
      const duration = Date.now() - start
      this.scheduleHealth.reportComplete('transactions:rechargeTimeout', false, duration, err instanceof Error ? err.message : String(err))
      // 未获取到锁（其他实例正在执行）静默跳过
      this.logger.debug(
        `充值超时兜底调度本轮跳过：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async scanTimeoutOrders() {
    const threshold = new Date(Date.now() - PENDING_TIMEOUT_MS)
    const orders = await this.prisma.transactionOrder.findMany({
      where: {
        type: TransactionType.RECHARGE,
        status: TransactionStatus.PENDING,
        createdAt: { lt: threshold },
      },
      take: 200, // 单轮扫描限流，剩余留给下一轮 cron
    })

    if (orders.length === 0) return
    this.logger.log(
      `发现 ${orders.length} 笔 PENDING 超过 15 分钟的充值订单，需核实渠道真实状态`,
    )

    for (const order of orders) {
      if (!order.channelOrderNo) {
        // 无 channelOrderNo：渠道调用成功后、持久化 channelOrderNo 前进程崩溃，
        // 回调将因 channelOrderNo 不匹配被拒（由 handleRechargeCallback 兜底补录覆盖正常回调，
        // 若回调未到达则订单卡死，无法主动查单，需人工核实是否已支付）
        this.logger.warn(
          `充值订单 ${order.orderNo} 处于 PENDING 超过 15 分钟且无渠道订单号，疑似渠道调用后崩溃，需人工核实是否已支付`,
        )
        continue
      }

      // 有渠道单号：主动查单补单（与回调共用锁与金额核对，幂等）
      try {
        const action = await this.transactionsService.reconcilePendingRecharge(order)
        if (action === 'CREDITED') {
          this.logger.warn(`充值订单 ${order.orderNo} 自动补单入账成功（渠道确认已支付）`)
        } else if (action === 'MARKED_FAILED') {
          this.logger.log(`充值订单 ${order.orderNo} 渠道查询为失败/关闭，已自动置为 FAILED`)
        } else if (action === 'STILL_PENDING') {
          this.logger.log(
            `充值订单 ${order.orderNo} 渠道查询仍为 PENDING 或查单未确认，保持 PENDING 等待下一轮`,
          )
        } else {
          this.logger.warn(
            `充值订单 ${order.orderNo}（渠道单号 ${order.channelOrderNo}）自动补单跳过，需人工核实渠道真实状态`,
          )
        }
      } catch (err) {
        this.logger.error(
          `充值订单 ${order.orderNo} 自动补单异常：${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
}
