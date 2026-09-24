import { Type } from 'class-transformer'
import { IsNumber, IsOptional, Min, Max } from 'class-validator'
import { RATE_DENOMINATOR } from '../../common/constants'

export class UpdateMerchantConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(RATE_DENOMINATOR, { message: '收款费率不能超过 100%' })
  @Type(() => Number)
  payRate?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(RATE_DENOMINATOR, { message: '提现费率不能超过 100%' })
  @Type(() => Number)
  withdrawRate?: number

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100_000_000, { message: '日限额过大' })
  @Type(() => Number)
  dailyLimit?: number
}
