/**
 * 通用展示格式化（H5 共享，替代各视图重复定义的本地 fmt）
 */

/** ISO 时间 → 'YYYY-MM-DD HH:mm'；空值返回 '' */
export function fmt(v?: string | null): string {
  return v ? v.replace('T', ' ').slice(0, 16) : ''
}

/** ISO 时间 → 'MM-DD HH:mm' 紧凑格式（首页流水等窄空间）；空值返回 '' */
export function fmtShort(v?: string | null): string {
  return v ? v.replace('T', ' ').slice(5, 16) : ''
}

/** ISO 时间 → 'YYYY/MM/DD HH:mm'（提现记录等列表用）；空值返回 '-' */
export function fmtSlash(v?: string | null): string {
  return v ? v.replace('T', ' ').slice(0, 16).replace(/-/g, '/') : '-'
}
