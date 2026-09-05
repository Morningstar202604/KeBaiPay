/**
 * 日期处理工具（统一使用 UTC，避免时区漂移）。
 * 基于 dayjs utc 插件，避免手写 Date 拼接的边界错误。
 */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

/**
 * 根据 YYYY-MM-DD 起止日期生成 [start, end] 闭区间（UTC）。
 * start 为当天 00:00:00.000Z，end 为当天 23:59:59.999Z。
 */
export function getDateRange(
  startDate: string,
  endDate: string,
): { start: Date; end: Date } {
  const start = dayjs.utc(startDate).startOf('day').toDate()
  const end = dayjs.utc(endDate).endOf('day').toDate()
  return { start, end }
}

/**
 * 返回前一天的 YYYY-MM-DD（UTC）。
 */
export function getPreviousDate(date: string): string {
  return dayjs.utc(date).subtract(1, 'day').format('YYYY-MM-DD')
}

/**
 * 格式化为 YYYY-MM-DD（UTC）。
 */
export function formatDate(date: Date): string {
  return dayjs.utc(date).format('YYYY-MM-DD')
}

/**
 * 返回今天的 [start, end] 闭区间（UTC）。
 */
export function getTodayRange(): { start: Date; end: Date } {
  const today = dayjs.utc()
  return {
    start: today.startOf('day').toDate(),
    end: today.endOf('day').toDate(),
  }
}

/** 业务日切时区：限额/风控/订单号日期前缀等"自然日"口径统一按北京时间计算 */
export const BUSINESS_TIMEZONE = 'Asia/Shanghai'

/**
 * 业务日键（P0-6 时区统一）。
 *
 * 返回业务时区（默认 Asia/Shanghai）下的 YYYY-MM-DD。
 * 此前的 `new Date().toISOString().slice(0, 10)` 是 UTC 日切：
 * 北京时间 0:00-8:00 的交易被计入"昨日"，日限额在早上 8 点才翻转，
 * 既是资损窗口也是风控口径错误。新代码禁止再用 UTC 日切。
 */
export function businessDayKey(date: Date = new Date()): string {
  // en-CA 区域的 ISO 风格格式恰好是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(date)
}

/**
 * 业务日键对应的业务时区日界（绝对时刻）：
 * 北京时间 [D 00:00:00.000, D 23:59:59.999]，即 UTC [D-1 16:00, D 16:00)。
 * Asia/Shanghai 无夏令时，固定 +08:00。
 *
 * 用于按 businessDayKey 聚合带时间的字段（如 completedAt）：
 * 直接 `${dateStr}T00:00:00.000Z` 拼接得到的是 UTC 日界，北京时间 0:00-8:00
 * 的交易会落在任何一天的窗口之外——限额聚合被绕过 8 小时。
 */
export function businessDayRange(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00+08:00`)
  const end = new Date(`${dateKey}T23:59:59.999+08:00`)
  return { start, end }
}
