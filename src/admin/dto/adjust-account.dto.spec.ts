import { describe, expect, it } from '@jest/globals'
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AdjustAccountDto } from './adjust-account.dto.js'

/**
 * 锁定管理员调账 DTO 的三道防线：
 * 1. 绝对值上限 ±500000（复用平台单笔限额，超限 400 而非 yuanToFen 裸 Error 500）
 * 2. maxDecimalPlaces=2（金额最小单位是分；亚分金额会被四舍五入成 0 分，
 *    产生金额为 0 的调账流水污染账本）
 * 3. 负数合法（扣款语义由服务层按符号处理，DTO 不得拦截负数）
 */
async function errorsOf(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(AdjustAccountDto, payload)
  const errors = await validate(dto)
  return errors.map((e) => e.property)
}

describe('AdjustAccountDto', () => {
  it('正常加款/扣款金额通过', async () => {
    expect(await errorsOf({ amount: 100, reason: '补偿' })).toEqual([])
    expect(await errorsOf({ amount: -10, reason: '扣回多付' })).toEqual([])
    expect(await errorsOf({ amount: 500000, reason: '上限边界' })).toEqual([])
    expect(await errorsOf({ amount: -500000, reason: '下限边界' })).toEqual([])
  })

  it('拒绝超出 ±500000 的金额', async () => {
    expect(await errorsOf({ amount: 500000.01, reason: 'r' })).toContain('amount')
    expect(await errorsOf({ amount: -500000.01, reason: 'r' })).toContain('amount')
    expect(await errorsOf({ amount: 600000, reason: 'r' })).toContain('amount')
  })

  it('拒绝亚分金额（0.001 四舍五入后为 0 分）', async () => {
    expect(await errorsOf({ amount: 0.001, reason: 'r' })).toContain('amount')
    expect(await errorsOf({ amount: -0.004, reason: 'r' })).toContain('amount')
  })

  it('拒绝超过 2 位小数', async () => {
    expect(await errorsOf({ amount: 1.999, reason: 'r' })).toContain('amount')
  })

  it('拒绝非数字与缺失 reason', async () => {
    expect(await errorsOf({ amount: 'abc', reason: 'r' })).toContain('amount')
    expect(await errorsOf({ amount: 100 })).toContain('reason')
  })
})
