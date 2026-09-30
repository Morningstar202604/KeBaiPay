import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  PaymentOrderStatus,
  ReconciliationStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { FinanceService } from './finance.service'
import { businessDayRange } from '../common/date-helpers'
import { fenToYuan } from '../common/helpers'
import { randomUUID } from 'crypto'
import { parseChannelBill, type BillRow } from './bill-parser'
import { escapeCsvField } from '../common/csv'

/**
 * 对账摘要结构（合规聚合模式）：
 * 平台不持有资金（totalAssets 恒为 0），对账口径为「收单订单 vs 持牌通道账单」：
 *  - totalRecharge  = 当日成功收单金额（原充值口径，语义改为收单收入）
 *  - totalPaymentFee = 当日收单手续费
 *  - totalRefund    = 当日退款金额
 *  - transactionCount = 当日成功订单笔数
 * 字段名保留兼容既有前端；通道账单文件核对为人工/离线步骤（见 PAYMENT_CHANNEL_CONFIG.md）。
 */
export interface ReconciliationSummary {
  totalAssets: number
  totalDebit: number
  totalCredit: number
  ledgerNetChange: number
  totalRecharge: number
  totalWithdrawal: number
  totalPaymentFee: number
  totalWithdrawalFee: number
  totalFee: number
  transactionCount: number
  previousTotalAssets: number
  actualAssetsChange: number
  expectedAssetsChange: number
  adjustmentNet: number
  totalRefund: number
  totalAssetsYuan: string
  totalRechargeYuan: string
  totalWithdrawalYuan: string
  totalPaymentFeeYuan: string
  totalFeeYuan: string
}

// 对账差异项结构
interface ReconciliationDifference {
  check: string
  message: string
  [key: string]: unknown
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
  ) {}

  /**
   * 运行当日对账（订单维度）
   *
   * 聚合模式下对账两步：
   * 1) 系统内核对：PaymentOrder 当日成功订单金额/手续费/退款与 DailySnapshot 快照一致
   * 2) 通道账单核对（离线/人工或后续接入）：下载持牌通道（微信/支付宝）官方账单，
   *    与当日成功订单逐笔匹配 —— 部署后需配置商户号后接入（见 docs/PAYMENT_CHANNEL_CONFIG.md）
   */
  async runReconciliation(date: string, checkedBy?: string) {
    const { start, end } = this.getDateRange(date)

    const [paidAgg, refundAgg, closedCount] = await Promise.all([
      this.prisma.paymentOrder.aggregate({
        where: {
          status: { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED] },
          paidAt: { gte: start, lte: end, not: null },
        },
        _sum: { amount: true, fee: true },
        _count: { id: true },
      }),
      this.prisma.paymentOrder.aggregate({
        where: {
          status: PaymentOrderStatus.REFUNDED,
          paidAt: { gte: start, lte: end, not: null },
        },
        _sum: { refundAmount: true },
      }),
      this.prisma.paymentOrder.count({
        where: {
          status: PaymentOrderStatus.CLOSED,
          updatedAt: { gte: start, lte: end },
        },
      }),
    ])

    const totalAssets = 0 // 资金池下线：平台不持有资金
    const totalDebit = 0
    const totalCredit = 0
    const ledgerNetChange = 0

    // 收单收入（成功订单金额）
    const totalRecharge = paidAgg._sum.amount || 0
    const totalPaymentFee = paidAgg._sum.fee || 0
    const totalWithdrawal = 0
    const totalWithdrawalFee = 0
    const totalFee = totalPaymentFee + totalWithdrawalFee
    const transactionCount = paidAgg._count.id || 0
    const totalRefund = refundAgg._sum.refundAmount || 0
    const adjustmentNet = 0

    // 系统内核对：快照（finance 日报）与订单统计一致
    const differences: ReconciliationDifference[] = []

    const snapshot = await this.prisma.dailySnapshot.findUnique({
      where: { date },
    })
    if (snapshot) {
      if (snapshot.totalIncome !== totalRecharge) {
        differences.push({
          check: 'snapshot_income_mismatch',
          message: `日报收入 ${snapshot.totalIncome} 与订单统计 ${totalRecharge} 不一致`,
          snapshot: snapshot.totalIncome,
          orders: totalRecharge,
        })
      }
      if (snapshot.totalFee !== totalFee) {
        differences.push({
          check: 'snapshot_fee_mismatch',
          message: `日报手续费 ${snapshot.totalFee} 与订单统计 ${totalFee} 不一致`,
          snapshot: snapshot.totalFee,
          orders: totalFee,
        })
      }
      if (snapshot.transactionCount !== transactionCount) {
        differences.push({
          check: 'snapshot_count_mismatch',
          message: `日报笔数 ${snapshot.transactionCount} 与订单统计 ${transactionCount} 不一致`,
          snapshot: snapshot.transactionCount,
          orders: transactionCount,
        })
      }
    } else {
      // 快照缺失：尝试补生成
      try {
        await this.financeService.generateDailySnapshot(date)
        this.logger.log(`对账前补生成 ${date} 日报快照成功`)
      } catch (err) {
        this.logger.error(`补生成 ${date} 快照失败`, err)
        differences.push({
          check: 'snapshot_missing',
          message: `日报快照缺失且生成失败，无法完成系统内核对`,
        })
      }
    }

    // 通道账单核对：优先引用当日已生成的账单核对记录（模拟演练或真实接入后均可）；
    // 未核对则该日为 pending，提示在 admin 对账页执行「通道账单模拟对账」或接入官方账单。
    const billCheck = await this.prisma.channelBillCheck.findFirst({
      where: { date },
      orderBy: { updatedAt: 'desc' },
    })
    if (billCheck) {
      differences.push({
        check: 'channel_bill',
        message: `通道账单核对(${billCheck.channel}): ${billCheck.status}，匹配 ${billCheck.matchedCount} 笔 / 差异 ${billCheck.mismatchCount} 笔`,
        billStatus: billCheck.status,
        billMatched: billCheck.matchedCount,
        billMismatch: billCheck.mismatchCount,
        billSource: billCheck.billSource,
      })
    } else {
      differences.push({
        check: 'channel_bill_pending',
        message: '通道账单核对待执行：可在 admin 对账页运行「通道账单模拟对账」演练，或接入持牌通道官方账单（详见 PAYMENT_CHANNEL_CONFIG.md）',
        closedCount,
      })
    }

    const previousTotalAssets = 0
    const actualAssetsChange = 0
    const expectedAssetsChange = 0

    const status =
      differences.filter(
        (d) => d.check !== 'channel_bill_pending' && !(d.check === 'channel_bill' && d.billStatus === 'MATCHED'),
      ).length === 0
        ? ReconciliationStatus.SUCCESS
        : ReconciliationStatus.FAILED

    const summary: ReconciliationSummary = {
      totalAssets,
      totalDebit,
      totalCredit,
      ledgerNetChange,
      totalRecharge,
      totalWithdrawal,
      totalPaymentFee,
      totalWithdrawalFee,
      totalFee,
      transactionCount,
      previousTotalAssets,
      actualAssetsChange,
      expectedAssetsChange,
      adjustmentNet,
      totalRefund,
      totalAssetsYuan: fenToYuan(totalAssets),
      totalRechargeYuan: fenToYuan(totalRecharge),
      totalWithdrawalYuan: fenToYuan(totalWithdrawal),
      totalPaymentFeeYuan: fenToYuan(totalPaymentFee),
      totalFeeYuan: fenToYuan(totalFee),
    }

    const report = await this.prisma.reconciliationReport.upsert({
      where: { date },
      create: {
        date,
        status,
        differences:
          differences.length > 0 ? JSON.stringify(differences) : null,
        summary: JSON.stringify(summary),
        checkedBy,
        checkedAt: new Date(),
      },
      update: {
        status,
        differences:
          differences.length > 0 ? JSON.stringify(differences) : null,
        summary: JSON.stringify(summary),
        checkedBy,
        checkedAt: new Date(),
      },
    })

    // 剥离 Prisma 返回的 Json 类型 summary，避免与本地 ReconciliationSummary 形成联合类型
    const { summary: _storedSummary, ...reportWithoutSummary } = report
    const parsedSummary = _storedSummary
      ? (JSON.parse(_storedSummary as string) as ReconciliationSummary)
      : summary
    return {
      ...reportWithoutSummary,
      summary: parsedSummary,
    }
  }

  async getReports(query: { startDate?: string; endDate?: string }) {
    const where: Prisma.ReconciliationReportWhereInput = {}
    if (query.startDate || query.endDate) {
      where.date = {}
      if (query.startDate) where.date.gte = query.startDate
      if (query.endDate) where.date.lte = query.endDate
    }

    const data = await this.prisma.reconciliationReport.findMany({
      where,
      orderBy: { date: 'desc' },
    })

    return { data }
  }

  async getReport(date: string) {
    return this.prisma.reconciliationReport.findUnique({
      where: { date },
    })
  }

  /**
   * 生成模拟通道账单（mock 通道账单文件）
   *
   * 从收单订单（当日该通道已支付/已退款）生成一份模拟账单文本，
   * 字段结构对齐主流持牌通道官方账单（订单号/流水号/金额/手续费/状态/时间）。
   * 真实通道商户号落地后，以官方账单文件替换本模拟来源即可。
   */
  async generateMockChannelBill(date: string, channel = 'mock') {
    const { start, end } = this.getDateRange(date)
    const orders = await this.prisma.paymentOrder.findMany({
      where: {
        channel,
        status: { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED] },
        paidAt: { gte: start, lte: end, not: null },
      },
      orderBy: { paidAt: 'asc' },
    })

    const header = '账单日期,商户订单号,通道流水号,交易金额(元),手续费(元),交易状态,交易时间'
    const rows = orders.map((o) => {
      const status = o.status === PaymentOrderStatus.REFUNDED ? 'REFUNDED' : 'PAID'
      return [
        date,
        o.orderNo,
        o.channelOrderNo || '',
        fenToYuan(o.amount),
        fenToYuan(o.fee || 0),
        status,
        o.paidAt ? o.paidAt.toISOString() : '',
      ].join(',')
    })
    const csv = '\uFEFF' + [header, ...rows].join('\n')

    return {
      date,
      channel,
      source: 'mock',
      billCount: orders.length,
      totalAmountFen: orders.reduce((sum, o) => sum + o.amount, 0),
      totalFeeFen: orders.reduce((sum, o) => sum + (o.fee || 0), 0),
      bill: csv,
      note: '模拟账单：基于当日收单订单生成，真实通道商户号接入后由官方账单替换',
    }
  }

  /**
   * 通道账单核对（模拟演练 / 真实账单通用入口）
   *
   * @param date 业务日
   * @param channel 通道编码（alipay | wechat | mock）
   * @param diff 差异注入（仅模拟场景，用于演示差异检出能力）：
   *   - missingPlatformOrders: 平台有、通道账单缺的笔数（模拟通道漏记）
   *   - extraChannelOrders: 通道有、平台无的笔数（模拟通道多记/盗刷）
   *   - amountMismatchOrders: 金额不一致笔数（模拟金额篡改）
   */
  async runChannelReconciliation(
    date: string,
    channel = 'mock',
    diff: {
      missingPlatformOrders?: number
      extraChannelOrders?: number
      amountMismatchOrders?: number
      /** 账单来源：mock（服务端基于订单生成模拟账单）| official（解析官方账单文件） */
      billSource?: 'mock' | 'official'
      /** official 模式必传：官方账单文件文本（微信/支付宝 CSV） */
      billText?: string
    } = {},
  ) {
    const { start, end } = this.getDateRange(date)
    const platformOrders = await this.prisma.paymentOrder.findMany({
      where: {
        channel,
        status: { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED] },
        paidAt: { gte: start, lte: end, not: null },
      },
      orderBy: { paidAt: 'asc' },
    })

    // —— 构造账单行 ——
    // official：解析官方账单文件（微信/支付宝 CSV），与订单逐笔核对
    // mock：基于当日订单生成模拟账单（字段对齐官方结构）
    let billRows: BillRow[]
    let parseWarnings: string[] = []
    if (diff.billSource === 'official') {
      if (!diff.billText) {
        throw new BadRequestException('official 模式必须提供 billText（官方账单文件内容）')
      }
      const parsed = parseChannelBill(diff.billText, channel as 'alipay' | 'wechat')
      billRows = parsed.rows
      parseWarnings = parsed.warnings
      this.logger.log(`解析官方账单(${channel}): ${parsed.rows.length} 行 / 跳过 ${parsed.skipped} 行 / 警告 ${parsed.warnings.length} 条`)
    } else {
      billRows = platformOrders.map((o) => ({
        orderNo: o.orderNo,
        channelOrderNo: o.channelOrderNo || '',
        amountFen: o.amount,
        feeFen: o.fee || 0,
        status: o.status as 'PAID' | 'REFUNDED',
        paidAt: o.paidAt || undefined,
      }))
    }

    // 差异注入（仅 mock 演练用，缺省不注入；official 真实账单不扰动）
    let platformOnly: typeof platformOrders = []
    if (diff.billSource !== 'official' && (diff.missingPlatformOrders || 0) > 0) {
      platformOnly = platformOrders.slice(0, diff.missingPlatformOrders)
      billRows.splice(0, diff.missingPlatformOrders!)
    }
    // 通道多记账：额外行（仅 mock 演练）
    const extraRows: typeof billRows = []
    for (let i = 0; i < (diff.billSource !== 'official' ? diff.extraChannelOrders || 0 : 0); i++) {
      extraRows.push({
        orderNo: 'MOCK-EXTRA-' + randomUUID().slice(0, 8),
        channelOrderNo: 'MOCK-CH-' + randomUUID().slice(0, 10),
        amountFen: 100 + Math.floor(Math.random() * 90000),
        feeFen: 0,
        status: PaymentOrderStatus.PAID,
        paidAt: new Date(start.getTime() + 1000 * i),
      })
    }
    // 金额不一致：改账单侧金额（仅 mock 演练）
    for (let i = 0; i < (diff.billSource !== 'official' ? diff.amountMismatchOrders || 0 : 0); i++) {
      if (billRows[i]) billRows[i].amountFen += 1
    }

    // —— 逐笔核对 ——
    const platformMap = new Map(platformOrders.map((o) => [o.orderNo, o]))
    const differences: Array<{
      type: string
      orderNo: string
      platformAmountFen?: number
      billAmountFen?: number
      message: string
    }> = []
    let matched = 0

    for (const row of billRows) {
      const p = platformMap.get(row.orderNo)
      if (!p) {
        differences.push({
          type: 'channel_only',
          orderNo: row.orderNo,
          billAmountFen: row.amountFen,
          message: '通道账单存在、平台无此订单（疑似通道多记）',
        })
        continue
      }
      if (p.amount !== row.amountFen) {
        differences.push({
          type: 'amount_mismatch',
          orderNo: row.orderNo,
          platformAmountFen: p.amount,
          billAmountFen: row.amountFen,
          message: '金额不一致：平台记录与通道账单不符',
        })
        continue
      }
      matched++
    }
    for (const o of platformOnly) {
      differences.push({
        type: 'platform_only',
        orderNo: o.orderNo,
        platformAmountFen: o.amount,
        message: '平台有订单、通道账单缺失（疑似通道漏记/未结算）',
      })
    }

    const status = differences.length === 0 ? 'MATCHED' : 'MISMATCH'
    const totalAmountFen = billRows.reduce((s, r) => s + r.amountFen, 0)
    const billCount = billRows.length + extraRows.length

    await this.prisma.channelBillCheck.upsert({
      where: { date_channel: { date, channel } },
      create: {
        date,
        channel,
        status,
        billSource: diff.billSource || 'mock',
        billCount: billCount,
        matchedCount: matched,
        mismatchCount: differences.length,
        platformCount: platformOrders.length,
        totalAmountFen,
        differences: differences.length > 0 ? JSON.stringify(differences) : null,
      },
      update: {
        status,
        billSource: diff.billSource || 'mock',
        billCount: billCount,
        matchedCount: matched,
        mismatchCount: differences.length,
        platformCount: platformOrders.length,
        totalAmountFen,
        differences: differences.length > 0 ? JSON.stringify(differences) : null,
      },
    })

    return {
      date,
      channel,
      status,
      billSource: diff.billSource || 'mock',
      billCount: billCount,
      platformCount: platformOrders.length,
      matchedCount: matched,
      mismatchCount: differences.length,
      totalAmountFen,
      differences,
      parseWarnings,
    }
  }

  /** 查询通道账单核对记录 */
  async getChannelBillChecks(query: { startDate?: string; endDate?: string; channel?: string }) {
    const where: Prisma.ChannelBillCheckWhereInput = {}
    if (query.startDate || query.endDate) {
      where.date = {}
      if (query.startDate) where.date.gte = query.startDate
      if (query.endDate) where.date.lte = query.endDate
    }
    if (query.channel) where.channel = query.channel
    const data = await this.prisma.channelBillCheck.findMany({
      where,
      orderBy: { date: 'desc' },
    })
    return { data }
  }

  /**
   * 导出对账报告 CSV
   *
   * 将指定日期范围内的对账报告导出为 CSV 字符串，包含日期、状态和差异摘要。
   */
  async exportReports(query: {
    startDate?: string
    endDate?: string
  }): Promise<string> {
    const { data } = await this.getReports(query)
    const header = '日期,状态,差异'
    const rows = data.map((item) =>
      [item.date, item.status, this.flattenDifferences(item.differences)]
        .map((f) => escapeCsvField(f))
        .join(','),
    )
    return '\uFEFF' + [header, ...rows].join('\n')
  }

  private flattenDifferences(differences: string | null): string {
    if (!differences) return ''
    try {
      const arr = JSON.parse(differences) as Array<{
        check: string
        message: string
      }>
      return arr.map((d) => `${d.check}: ${d.message}`).join('；')
    } catch {
      return differences
    }
  }

  private getDateRange(date: string) {
    // 业务日口径（北京时间）：与限额/风控/财务日报统一
    return businessDayRange(date)
  }

}
