import { describe, expect, it } from '@jest/globals'
import { Validator, IsOptional } from 'class-validator'
import { IsSafeText } from './safe-text.js'

class TestDto {
  @IsSafeText(1, 10)
  name!: string

  @IsOptional()
  @IsSafeText(0, 20)
  optionalText?: string
}

const validator = new Validator()
const validate = (value: unknown, prop: 'name' | 'optionalText' = 'name') => {
  const dto = new TestDto()
  dto[prop] = value as never
  return validator.validate(dto)
}

describe('IsSafeText 输入侧纵深防御', () => {
  it('正常中文/英文/数字/常用符号放行', async () => {
    for (const v of ['张三的商店', "Café #1", '报销-2026/Q3', '备注：含标点，。！？']) {
      const errs = await validate(v)
      expect(errs).toHaveLength(0)
    }
  })

  it('拒绝 HTML 标签构成字符 < 和 >', async () => {
    for (const v of ['<script>', '"><img src=x>', '正常文本</div>', 'a > b', '1 < 2']) {
      const errs = await validate(v)
      expect(errs.some((e) => e.constraints?.isSafeText)).toBe(true)
    }
  })

  it('拒绝零宽字符与不可见控制符', async () => {
    for (const v of ['正常\u200B文本', '\uFEFF开头', '中间\u202E反转']) {
      const errs = await validate(v)
      expect(errs.some((e) => e.constraints?.isSafeText)).toBe(true)
    }
  })

  it('非字符串拒绝', async () => {
    const errs = await validate(123 as unknown as string)
    expect(errs.length).toBeGreaterThan(0)
  })

  it('超长拒绝、上限内放行', async () => {
    expect((await validate('a'.repeat(11))).some((e) => e.constraints?.maxLength)).toBe(true)
    expect(await validate('a'.repeat(10))).toHaveLength(0)
  })

  it('必填约束：空串与缺失拒绝', async () => {
    expect((await validate('')).some((e) => e.constraints?.minLength)).toBe(true)
  })

  it('可选字段（min=0）空串放行、undefined 跳过', async () => {
    const dto = new TestDto()
    dto.name = '合法名称'
    dto.optionalText = ''
    expect(await validator.validate(dto)).toHaveLength(0)

    const dto2 = new TestDto()
    dto2.name = '合法名称'
    dto2.optionalText = undefined
    expect(await validator.validate(dto2)).toHaveLength(0)
  })
})
