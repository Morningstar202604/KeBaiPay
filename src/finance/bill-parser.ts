import { Logger } from '@nestjs/common'

/**
 * 通道官方账单解析器（微信支付 / 支付宝）
 *
 * 目标：把持牌通道商户平台下载的官方交易账单（CSV）解析成统一行结构，
 * 与收单订单（PaymentOrder）逐笔核对。字段结构对齐官方账单格式：
 *  - 微信支付：交易账单（V2/V3 均兼容，按表头关键词定位列）
 *  - 支付宝：交易账单（对账单 CSV）
 *
 * 用法：拿到真实商户号后，下载官方账单 → 把文件文本交给 parseChannelBill
 * （或直接调用 parseWechatBill / parseAlipayBill）→ 结果喂给
 * ReconciliationService.runChannelReconciliation({ billSource: 'official' }).
 */

export interface BillRow {
  /** 商户订单号（对应平台 orderNo） */
  orderNo: string
  /** 通道流水号（微信订单号 / 支付宝交易号，对应平台 channelOrderNo） */
  channelOrderNo: string
  /** 订单金额（分） */
  amountFen: number
  /** 手续费（分） */
  feeFen: number
  /** PAID | REFUNDED（与平台 PaymentOrderStatus 对齐） */
  status: 'PAID' | 'REFUNDED'
  /** 交易时间 */
  paidAt?: Date
}

export interface BillParseResult {
  rows: BillRow[]
  /** 跳过的行数（表头/汇总/空行/无法识别的行） */
  skipped: number
  warnings: string[]
}

const logger = new Logger('BillParser')

/** 简单 CSV 行解析：兼容引号包裹的字段（字段内逗号不分割） */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (ch === ',' && !inQuote) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** 元 → 分（处理「1.23」「1.2」「1」以及负号与千分位外的非数字字符） */
function yuanToFen(v: string): number {
  if (v === undefined || v === null || v.trim() === '' || v.trim() === '-') return 0
  const cleaned = v.replace(/[,，]/g, '').replace(/[^\d.-]/g, '')
  const n = parseFloat(cleaned)
  if (Number.isNaN(n)) return 0
  return Math.round(n * 100)
}

/** 时间解析：兼容 `2023-01-01 10:00:00` / `2023-01-01 10:00` / 空 */
function parseBillTime(v: string): Date | undefined {
  if (!v || v.trim() === '') return undefined
  // 兼容 `2023-01-01 10:00:00` 与 `2023/01/01 10:00:00`（V8 可解析）
  const d = new Date(v.replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * 微信支付交易账单解析
 *
 * 兼容 V2 与 V3 表头，按关键词定位列：
 *  - 商户订单号：表头含「商户订单号」
 *  - 微信订单号：表头含「微信订单号」
 *  - 金额：V3「应结金额」/ V2「总金额」（交易成功行的订单金额）
 *  - 手续费：表头含「手续费」
 *  - 交易状态：表头含「交易状态」（SUCCESS=成功）
 *  - 退款：退款单号非空或退款金额 > 0 视为退款单（REFUNDED）
 */
export function parseWechatBill(text: string): BillParseResult {
  const rows: BillRow[] = []
  const warnings: string[] = []
  let skipped = 0

  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  let headerIdx = -1
  let cols: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    if (cells.some((c) => c.includes('商户订单号') && c.includes('订单号'))) {
      headerIdx = i
      cols = cells
      break
    }
  }
  if (headerIdx === -1) {
    warnings.push('未找到表头行（需包含「商户订单号」列）')
    return { rows, skipped: lines.length, warnings }
  }

  const col = (name: string): number => cols.findIndex((c) => c.includes(name))
  const iOrder = col('商户订单号')
  const iWx = cols.findIndex((c) => c.includes('微信订单号'))
  const iAmount = cols.findIndex((c) => c.includes('应结金额') || c.includes('总金额'))
  const iFee = col('手续费')
  const iStatus = col('交易状态')
  const iTime = col('交易时间')
  const iRefundNo = cols.findIndex((c) => c.includes('微信退款单号') || c.includes('商户退款单号'))
  const iRefundAmount = cols.findIndex((c) => c.includes('退款金额') && !c.includes('申请退款'))

  for (let i = headerIdx + 1; i < lines.length; i++) {
    let cells = splitCsvLine(lines[i])
    // 兼容行尾逗号（微信账单每行尾带逗号）：裁剪多余尾空列
    while (cells.length > cols.length && cells[cells.length - 1] === '') cells.pop()
    // 列数与表头不一致：提示错位风险（真实账单可能含引号包裹的逗号字段）
    if (cells.length !== cols.length && !warnings.includes('存在数据行列数与表头不一致的行，请人工核对')) {
      warnings.push('存在数据行列数与表头不一致的行，请人工核对')
    }
    // 微信账单末尾有汇总行（总交易单数/总退款单数等），跳过无订单号的
    if (cells[iOrder] === undefined || cells[iOrder].trim() === '') {
      skipped++
      continue
    }
    const orderNo = cells[iOrder].trim()
    // 微信账单订单号前可能带 ` 前缀（部分版本在字段前加反引号）
    const norm = (v: string) => v.replace(/^`/, '').trim()
    const refundNo = iRefundNo >= 0 && cells[iRefundNo] !== undefined ? norm(cells[iRefundNo]) : ''
    const refundAmount = iRefundAmount >= 0 ? yuanToFen(cells[iRefundAmount]) : 0
    const statusRaw = iStatus >= 0 && cells[iStatus] !== undefined ? cells[iStatus].trim() : ''
    const isRefund = refundNo !== '' || refundAmount > 0 || /^REFUND/i.test(statusRaw)

    rows.push({
      orderNo,
      channelOrderNo: iWx >= 0 && cells[iWx] !== undefined ? norm(cells[iWx]) : '',
      amountFen: iAmount >= 0 && cells[iAmount] !== undefined ? yuanToFen(cells[iAmount]) : 0,
      feeFen: iFee >= 0 && cells[iFee] !== undefined ? yuanToFen(cells[iFee]) : 0,
      status: isRefund ? 'REFUNDED' : 'PAID',
      paidAt: iTime >= 0 && cells[iTime] !== undefined ? parseBillTime(cells[iTime]) : undefined,
    })
  }

  return { rows, skipped, warnings }
}

/**
 * 支付宝交易账单解析
 *
 * 按关键词定位列：
 *  - 商户订单号：表头含「商户订单号」
 *  - 支付宝交易号：表头含「支付宝交易号」或「交易号」
 *  - 订单金额：表头含「订单金额（元）」或「订单金额」
 *  - 服务费：表头含「服务费」
 *  - 业务类型：表头含「业务类型」（含「退款」= 退款单）
 *  - 退款批次号：表头含「退款批次号」（非空 = 退款单）
 *  - 时间：表头含「完成时间」或「创建时间」
 */
export function parseAlipayBill(text: string): BillParseResult {
  const rows: BillRow[] = []
  const warnings: string[] = []
  let skipped = 0

  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  let headerIdx = -1
  let cols: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    if (cells.some((c) => c.includes('商户订单号'))) {
      headerIdx = i
      cols = cells
      break
    }
  }
  if (headerIdx === -1) {
    warnings.push('未找到表头行（需包含「商户订单号」列）')
    return { rows, skipped: lines.length, warnings }
  }

  const iOrder = cols.findIndex((c) => c.includes('商户订单号'))
  const iAli = cols.findIndex((c) => c.includes('支付宝交易号') || c.includes('交易号'))
  const iAmount = cols.findIndex((c) => c.includes('订单金额'))
  const iFee = cols.findIndex((c) => c.includes('服务费'))
  const iBiz = cols.findIndex((c) => c.includes('业务类型'))
  const iRefundNo = cols.findIndex((c) => c.includes('退款批次号'))
  const iTime = cols.findIndex((c) => c.includes('完成时间') || c.includes('创建时间'))

  for (let i = headerIdx + 1; i < lines.length; i++) {
    let cells = splitCsvLine(lines[i])
    while (cells.length > cols.length && cells[cells.length - 1] === '') cells.pop()
    if (cells.length !== cols.length && !warnings.includes('存在数据行列数与表头不一致的行，请人工核对')) {
      warnings.push('存在数据行列数与表头不一致的行，请人工核对')
    }
    if (cells[iOrder] === undefined || cells[iOrder].trim() === '') {
      skipped++
      continue
    }
    const orderNo = cells[iOrder].trim()
    const bizRaw = iBiz >= 0 && cells[iBiz] !== undefined ? cells[iBiz] : ''
    const refundNo = iRefundNo >= 0 && cells[iRefundNo] !== undefined ? cells[iRefundNo].trim() : ''
    const isRefund = /退款/.test(bizRaw) || refundNo !== ''

    rows.push({
      orderNo,
      channelOrderNo: iAli >= 0 && cells[iAli] !== undefined ? cells[iAli].trim() : '',
      amountFen: iAmount >= 0 && cells[iAmount] !== undefined ? yuanToFen(cells[iAmount]) : 0,
      feeFen: iFee >= 0 && cells[iFee] !== undefined ? yuanToFen(cells[iFee]) : 0,
      status: isRefund ? 'REFUNDED' : 'PAID',
      paidAt: iTime >= 0 && cells[iTime] !== undefined ? parseBillTime(cells[iTime]) : undefined,
    })
  }

  return { rows, skipped, warnings }
}

/**
 * 统一入口：按通道解析官方账单
 * mock 通道直接返回空（模拟账单由服务端基于订单生成，不走文件解析）
 */
export function parseChannelBill(
  text: string,
  channel: 'alipay' | 'wechat' | 'mock',
): BillParseResult {
  if (channel === 'wechat') return parseWechatBill(text)
  if (channel === 'alipay') return parseAlipayBill(text)
  logger.warn(`mock 通道无需解析文件，返回空结果`)
  return { rows: [], skipped: 0, warnings: ['mock 通道不解析官方账单文件'] }
}
