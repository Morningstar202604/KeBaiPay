import { validate } from 'class-validator'
import { IsPayPassword, PAY_PASSWORD_REGEX } from './pay-password'

class Dto {
  @IsPayPassword()
  payPassword!: string
}

async function errorsFor(value: unknown): Promise<string[]> {
  const d = new Dto()
  d.payPassword = value as string
  const errors = await validate(d)
  return errors.map((e) => Object.keys(e.constraints ?? {}).join(','))
}

describe('IsPayPassword', () => {
  it('单一事实来源：正则恒为 6 位纯数字', () => {
    expect(PAY_PASSWORD_REGEX.source).toBe('^\\d{6}$')
  })

  it('接受合法 6 位纯数字', async () => {
    for (const v of ['123456', '000000', '654321', '999999']) {
      expect(await errorsFor(v)).toEqual([])
    }
  })

  it('拒绝空值', async () => {
    expect(await errorsFor('')).not.toEqual([])
  })

  it('拒绝非 6 位长度', async () => {
    for (const v of ['12345', '1234567', '12345678']) {
      expect(await errorsFor(v)).not.toEqual([])
    }
  })

  it('拒绝含字母/符号', async () => {
    for (const v of ['abcdef', '12a456', '12345#', '１２３４５６']) {
      expect(await errorsFor(v)).not.toEqual([])
    }
  })

  it('拒绝非字符串', async () => {
    expect(await errorsFor(123456 as unknown as string)).not.toEqual([])
    expect(await errorsFor(null as unknown as string)).not.toEqual([])
  })
})
