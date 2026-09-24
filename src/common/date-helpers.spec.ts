import { describe, expect, it } from '@jest/globals'
import {
  getDateRange,
  getPreviousDate,
  formatDate,
  getTodayRange,
  businessDayKey,
  businessDayRange,
} from './date-helpers.js'

describe('common/date-helpers', () => {
  describe('getDateRange', () => {
    it('生成 UTC 闭区间', () => {
      const { start, end } = getDateRange('2026-06-01', '2026-06-30')
      expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
      expect(end.toISOString()).toBe('2026-06-30T23:59:59.999Z')
    })

    it('起止为同一天', () => {
      const { start, end } = getDateRange('2026-01-15', '2026-01-15')
      expect(start.toISOString()).toBe('2026-01-15T00:00:00.000Z')
      expect(end.toISOString()).toBe('2026-01-15T23:59:59.999Z')
    })
  })

  describe('getPreviousDate', () => {
    it('返回前一天 YYYY-MM-DD', () => {
      expect(getPreviousDate('2026-06-26')).toBe('2026-06-25')
    })

    it('跨月', () => {
      expect(getPreviousDate('2026-07-01')).toBe('2026-06-30')
    })

    it('跨年', () => {
      expect(getPreviousDate('2026-01-01')).toBe('2025-12-31')
    })

    it('闰年 2 月', () => {
      expect(getPreviousDate('2024-03-01')).toBe('2024-02-29')
    })
  })

  describe('formatDate', () => {
    it('格式化为 YYYY-MM-DD', () => {
      expect(formatDate(new Date('2026-06-26T15:30:00.000Z'))).toBe('2026-06-26')
    })

    it('午夜边界', () => {
      expect(formatDate(new Date('2026-06-26T00:00:00.000Z'))).toBe('2026-06-26')
    })
  })

  describe('getTodayRange', () => {
    it('返回今天 UTC 闭区间', () => {
      const { start, end } = getTodayRange()
      const today = new Date().toISOString().slice(0, 10)
      expect(start.toISOString()).toBe(`${today}T00:00:00.000Z`)
      expect(end.toISOString()).toBe(`${today}T23:59:59.999Z`)
    })
  })

  // D1 资金日切口径：北京时间日键与日界（资金/限额核心聚合函数，此前零测试）
  describe('businessDayKey / businessDayRange（北京时间日切）', () => {
    it('北京凌晨 1 点（UTC 17:00 前一日）仍归属当日业务日', () => {
      // 2026-06-26 01:30 +08 == 2026-06-25 17:30 UTC
      const d = new Date('2026-06-25T17:30:00.000Z')
      expect(businessDayKey(d)).toBe('2026-06-26')
    })

    it('UTC 日切与北京时间日切在 8 点前不同（防 UTC 日切回归）', () => {
      const d = new Date('2026-06-25T20:00:00.000Z') // 北京 06-26 04:00
      expect(businessDayKey(d)).toBe('2026-06-26')
      // 若误用 UTC 日切会得到 06-25，此断言防资损窗口回归
      expect(d.toISOString().slice(0, 10)).toBe('2026-06-25')
    })

    it('businessDayRange 返回北京时间日界（非 UTC 拼接）', () => {
      const { start, end } = businessDayRange('2026-06-26')
      // 北京 00:00 == UTC 前一日 16:00
      expect(start.toISOString()).toBe('2026-06-25T16:00:00.000Z')
      // 北京 23:59:59.999 == UTC 当日 15:59:59.999
      expect(end.toISOString()).toBe('2026-06-26T15:59:59.999Z')
    })

    it('start/end 都落在北京时间当日内', () => {
      const { start, end } = businessDayRange('2026-01-01')
      expect(start.getUTCHours()).toBe(16)
      expect(start.getUTCDate()).toBe(31)
      expect(end.getUTCHours()).toBe(15)
    })
  })
})
