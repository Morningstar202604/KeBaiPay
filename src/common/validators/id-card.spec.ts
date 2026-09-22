import { describe, expect, it } from '@jest/globals'
import { isValidIdCard, idCardChecksum } from './id-card.js'

describe('isValidIdCard 身份证号校验（GB 11643）', () => {
  it('合法 18 位号码通过（110101199003073845，校验位 5）', () => {
    expect(isValidIdCard('110101199003073845')).toBe(true)
  })

  it('校验位 X 的合法号码通过（大小写不敏感）', () => {
    const full = '11010119900307002X'
    expect(idCardChecksum(full.slice(0, 17))).toBe('X')
    expect(isValidIdCard(full)).toBe(true)
    expect(isValidIdCard(full.toLowerCase())).toBe(true)
  })

  it('校验位错误被拒绝', () => {
    expect(isValidIdCard('110101199003073847')).toBe(false) // 正确尾号应为 5
  })

  it(' 出生日期非法（13 月）被拒绝', () => {
    // 先构造一个校验位正确的假日期号码，证明日期校验独立生效
    const prefix = '11010119901307001'
    const full = prefix + idCardChecksum(prefix)
    expect(isValidIdCard(full)).toBe(false)
  })

  it('2 月 30 日被拒绝', () => {
    const prefix = '11010119900230001'
    const full = prefix + idCardChecksum(prefix)
    expect(isValidIdCard(full)).toBe(false)
  })

  it('位数不对（14/16/19 位）被拒绝', () => {
    expect(isValidIdCard('11010119900307')).toBe(false)
    expect(isValidIdCard('1101011990030738450')).toBe(false)
    expect(isValidIdCard('110101199003078')).toBe(false)
  })

  it('含字母/特殊字符的非 15/18 位输入被拒绝', () => {
    expect(isValidIdCard('')).toBe(false)
    expect(isValidIdCard('abc')).toBe(false)
    expect(isValidIdCard('11010119900307384-')).toBe(false)
  })

  it('合法 15 位旧证通过', () => {
    expect(isValidIdCard('110101900307384')).toBe(true)
  })

  it('15 位旧证日期非法被拒绝', () => {
    expect(isValidIdCard('110101901338384')).toBe(false) // 13 月
  })

  it('idCardChecksum 与已知号码互洽', () => {
    expect(idCardChecksum('11010119900307384')).toBe('5')
    expect(idCardChecksum('11010119900101123')).toBe('7')
  })

  it('非字符串输入被拒绝（装饰器防御）', () => {
    // @ts-expect-error 故意传入非字符串验证运行时防御
    expect(isValidIdCard(null)).toBe(false)
    expect(isValidIdCard(123 as unknown as string)).toBe(false)
  })
})
