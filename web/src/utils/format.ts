/**
 * 通用展示格式化（商户后台共享，替代各视图重复定义的本地 fmt）
 */

/** ISO 时间 → 'YYYY-MM-DD HH:mm:ss'；空值返回 '-' */
export function fmt(v?: string | null): string {
  return v ? v.replace('T', ' ').slice(0, 19) : '-'
}
