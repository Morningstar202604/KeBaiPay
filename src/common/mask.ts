/**
 * 敏感字段脱敏工具。
 */

/**
 * 手机号脱敏：保留前 3 位和后 4 位，中间用 **** 替代。例：138****1234
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length <= 7) return '****'
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

/**
 * 身份证号脱敏：保留前 3 位和后 4 位，中间每一位用 * 替代。例：110***********1234
 */
export function maskIdCard(idCard: string): string {
  if (!idCard || idCard.length <= 7) return '****'
  return `${idCard.slice(0, 3)}${'*'.repeat(idCard.length - 7)}${idCard.slice(-4)}`
}

/**
 * 银行卡号脱敏：保留前 4 位和后 4 位，中间用 **** 替代。例：6228****1234
 */
export function maskBankCard(card: string): string {
  if (!card || card.length <= 8) return '****'
  return `${card.slice(0, 4)}****${card.slice(-4)}`
}
