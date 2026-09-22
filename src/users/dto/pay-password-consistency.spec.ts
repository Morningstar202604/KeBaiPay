import { describe, expect, it } from '@jest/globals'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ResetPayPasswordDto } from './reset-pay-password.dto.js'
import { VerifyIdentityDto } from './verify-identity.dto.js'

/**
 * 回归锁：重置支付密码与实名认证必须用同一套身份证格式规则（GB 11643）。
 *
 * 历史缺陷：ResetPayPasswordDto.idCard 只做 @MinLength(15)/@MaxLength(18) 长度校验，
 * 任意 15-18 位字符串（如 '123456789012345'）都能通过 DTO 层，把校验责任
 * 全部推给 service 的库内比对，导致格式非法时返回误导性的"实名信息不匹配"。
 * 现已统一为 @IsIdCard()，本测试防止其再次漂移。
 */

const VALID_ID = '110101199003073845' // 校验位正确

async function errorsOf(
  cls: new () => object,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(cls, payload)
  const errors = await validate(dto)
  return errors.map((e) => e.property)
}

describe('reset-pay-password / verify-identity 身份证校验一致性', () => {
  it('两处都接受校验位正确的 18 位身份证号', async () => {
    const reset = await errorsOf(ResetPayPasswordDto, {
      realName: '张三',
      idCard: VALID_ID,
      newPayPassword: '123456',
    })
    const verify = await errorsOf(VerifyIdentityDto, {
      realName: '张三',
      idCard: VALID_ID,
      payPassword: '123456',
    })
    expect(reset).toEqual([])
    expect(verify).toEqual([])
  })

  it('两处都拒绝仅长度合规但格式非法的身份证号', async () => {
    const bad = [
      '123456789012345',   // 15 位纯数字，日期段非法
      '12345678901234',    // 14 位
      'abcdefghijklmnopqr', // 18 位全字母
      '110101199003073846', // 18 位但校验位错误
      '110101199013073845', // 月份 13 非法
    ]
    for (const idCard of bad) {
      const reset = await errorsOf(ResetPayPasswordDto, {
        realName: '张三',
        idCard,
        newPayPassword: '123456',
      })
      const verify = await errorsOf(VerifyIdentityDto, {
        realName: '张三',
        idCard,
        payPassword: '123456',
      })
      expect(reset).toContain('idCard')
      expect(verify).toContain('idCard')
    }
  })

  it('重置支付密码的新密码仍受 6 位纯数字约束', async () => {
    for (const bad of ['12345', '1234567', 'abcdef']) {
      const errs = await errorsOf(ResetPayPasswordDto, {
        realName: '张三',
        idCard: VALID_ID,
        newPayPassword: bad,
      })
      expect(errs).toContain('newPayPassword')
    }
  })
})
