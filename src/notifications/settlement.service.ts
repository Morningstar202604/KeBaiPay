import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from './notifications.service'
import { formatDate, getPreviousDate, getDateRange } from '../common/date-helpers'

export interface SettlementResult {
  merchantId: string
  merchantName: string
  orderCount: number
  totalAmount: number
  totalFee: number
  settleAmount: number
  status: 'SUCCESS' | 'SKIPPED' | 'ERROR'
  reason?: string
}

/**
 * T+1 结算（日结账单）。
 *
 * 资金模型说明：商户收款在支付成功时已实时入账
 * （见 cashier.service.ts 支付成功事务中的 availableBalance increment），
 * 因此本任务只做三件事，绝不再动任何余额：
 * 1. 幂等标记订单 settledAt（条件 updateMany 抢占，防止并发重复出账单）；
 * 2. 汇总昨日已支付订单生成结算单；
 * 3. 通知商户。
 *
 * 历史版本曾在此处二次给商户加余额并写非法枚举（type=SETTLEMENT /
 * direction=IN）的账本，属于双入账资金事故，已移除。
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * T+1 结算：结算昨天已支付的订单（仅出账单+通知，不动余额）
   */
  async runDailySettlement(): Promise<SettlementResult[]> {
    const results: SettlementResult[] = []
    // 统一使用 UTC 日界，避免 setHours(0,0,0,0) 的本地时区漂移导致漏结/多结
    const yesterdayStr = getPreviousDate(formatDate(new Date()))
    const { start: yesterday, end: yesterdayEnd } = getDateRange(yesterdayStr, yesterdayStr)

    this.logger.log(`开始 T+1 结算，结算日期: ${yesterdayStr}`)

    // 查找昨天已支付但未结算的订单
    const unpaidSettlements = await this.prisma.paymentOrder.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: yesterday, lte: yesterdayEnd },
        settledAt: null,
      },
      include: { merchant: true },
    })

    if (unpaidSettlements.length === 0) {
      this.logger.log('没有需要结算的订单')
      return results
    }

    // 按商户分组
    const merchantGroups = new Map<string, typeof unpaidSettlements>()
    for (const order of unpaidSettlements) {
      const key = order.merchantId
      if (!merchantGroups.has(key)) merchantGroups.set(key, [])
      merchantGroups.get(key)!.push(order)
    }

    // 逐商户出结算单
    for (const [merchantId, orders] of merchantGroups) {
      try {
        const merchant = orders[0].merchant
        const totalAmount = orders.reduce((sum, o) => sum + o.amount, 0)
        const totalFee = orders.reduce((sum, o) => sum + o.fee, 0)
        const settleAmount = totalAmount - totalFee

        // 幂等抢占式更新结算标记：只标记仍为 settledAt=null 的订单。
        // 若 count < orders.length，说明有并发实例已处理部分订单，
        // 为避免重复出账单，本次按剩余未结算订单重新汇总。
        const settled = await this.prisma.paymentOrder.updateMany({
          where: { id: { in: orders.map((o) => o.id) }, settledAt: null },
          data: { settledAt: new Date() },
        })
        if (settled.count === 0) {
          const result: SettlementResult = {
            merchantId,
            merchantName: merchant.merchantName,
            orderCount: orders.length,
            totalAmount,
            totalFee,
            settleAmount,
            status: 'SKIPPED',
            reason: '已被其他实例结算',
          }
          results.push(result)
          continue
        }
        if (settled.count < orders.length) {
          this.logger.warn(
            `商户 ${merchant.merchantName} 有 ${orders.length - settled.count} 笔订单被并发处理，` +
              `本账单以实际抢到的 ${settled.count} 笔为准`,
          )
        }

        // 发送结算通知
        const merchantUser = await this.prisma.user.findUnique({
          where: { id: merchant.userId },
        })
        if (merchantUser?.email) {
          await this.notifications.notifySettlementComplete(
            merchantUser.email,
            merchant.merchantName,
            (settleAmount / 100).toFixed(2),
            yesterday.toISOString().split('T')[0],
          )
        }

        const result: SettlementResult = {
          merchantId,
          merchantName: merchant.merchantName,
          orderCount: orders.length,
          totalAmount,
          totalFee,
          settleAmount,
          status: 'SUCCESS',
        }
        results.push(result)
        this.logger.log(
          `商户 ${merchant.merchantName} 结算账单完成: ${orders.length} 笔, ` +
          `总金额 ¥${(totalAmount / 100).toFixed(2)}, ` +
          `手续费 ¥${(totalFee / 100).toFixed(2)}, ` +
          `结算 ¥${(settleAmount / 100).toFixed(2)}（款项已在支付时实时入账）`,
        )
      } catch (err) {
        const result: SettlementResult = {
          merchantId,
          merchantName: orders[0].merchant.merchantName,
          orderCount: orders.length,
          totalAmount: orders.reduce((s, o) => s + o.amount, 0),
          totalFee: orders.reduce((s, o) => s + o.fee, 0),
          settleAmount: 0,
          status: 'ERROR',
          reason: (err as Error).message,
        }
        results.push(result)
        this.logger.error(`商户 ${result.merchantName} 结算失败: ${result.reason}`)
      }
    }

    this.logger.log(`T+1 结算完成，共处理 ${results.length} 个商户`)
    return results
  }

  async getUnsettledSummary() {
    const grouped = await this.prisma.paymentOrder.groupBy({
      by: ['merchantId'],
      where: { status: 'PAID', settledAt: null },
      _count: { id: true },
      _sum: { amount: true, fee: true },
    })

    if (grouped.length === 0) {
      return { totalCount: 0, totalAmount: 0, merchants: [] }
    }

    const merchantIds = grouped.map((g) => g.merchantId)
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, merchantName: true },
    })
    const merchantNameMap = new Map(merchants.map((m) => [m.id, m.merchantName]))

    const totalCount = grouped.reduce((s, g) => s + g._count.id, 0)
    const totalAmount = grouped.reduce((s, g) => s + (g._sum.amount || 0), 0)

    return {
      totalCount,
      totalAmount,
      merchants: grouped.map((g) => ({
        merchantId: g.merchantId,
        merchantName: merchantNameMap.get(g.merchantId) || '',
        count: g._count.id,
        amount: g._sum.amount || 0,
        fee: g._sum.fee || 0,
        settleAmount: (g._sum.amount || 0) - (g._sum.fee || 0),
      })),
    }
  }
}
