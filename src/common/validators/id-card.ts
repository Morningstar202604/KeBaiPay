import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator'

/**
 * 大陆居民身份证号校验（GB 11643-1999）
 *
 * - 18 位：地址码（6 位数字）+ 出生日期（YYYYMMDD，含日期合法性）+ 顺序码（3 位）+ 校验位
 * - 15 位（旧证）：地址码 + YYMMDD + 顺序码，自动按历史规则放行
 * - 校验位按 ISO 7064:1983 MOD 11-2 加权算法验证
 *
 * 注意：格式合法 ≠ 号码真实存在。号码与姓名的对应关系需通过实名核验
 * 服务（见 REALNAME_VERIFY_PROVIDER）或人工审核确认。
 */

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

/** 18 位身份证校验位计算。输入 17 位数字前缀，返回校验位字符。 */
export function idCardChecksum(prefix17: string): string {
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += Number(prefix17[i]) * WEIGHTS[i]
  }
  return CHECK_CODES[sum % 11]
}

/** 日期部分合法性（1900-2100 范围内的真实日期） */
function isValidDate(fullDate: string): boolean {
  const year = Number(fullDate.slice(0, 4))
  const month = Number(fullDate.slice(4, 6))
  const day = Number(fullDate.slice(6, 8))
  if (year < 1900 || year > 2100) return false
  if (month < 1 || month > 12) return false
  const daysInMonth = new Date(year, month, 0).getDate()
  return day >= 1 && day <= daysInMonth
}

export function isValidIdCard(value: string): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim().toUpperCase()

  // 18 位：地址码 + 日期 + 顺序码 + 校验位
  if (v.length === 18) {
    if (!/^\d{17}[\dX]$/.test(v)) return false
    if (!isValidDate(v.slice(6, 14))) return false
    return idCardChecksum(v.slice(0, 17)) === v[17]
  }

  // 15 位旧证：地址码 + YYMMDD（19xx）+ 顺序码，无校验位
  if (v.length === 15) {
    if (!/^\d{15}$/.test(v)) return false
    return isValidDate(`19${v.slice(6, 12)}`)
  }

  return false
}

export function IsIdCard(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIdCard',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidIdCard(value)
        },
        defaultMessage(args?: ValidationArguments) {
          return `${args?.property ?? '身份证号'} 格式不正确`
        },
      },
    })
  }
}
