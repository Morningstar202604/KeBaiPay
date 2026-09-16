import { IsNumber, IsString, IsOptional, IsPositive, IsNotEmpty, Min, Max, Matches } from 'class-validator'
import { Type } from 'class-transformer'
import { IsSafeText } from '../../common/validators/safe-text'
import { IsPayPassword } from '../../common/validators/pay-password'

export class CreateWithdrawalDto {
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount!: number

  @IsPayPassword()
  payPassword!: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{12,19}$/, { message: '银行卡号格式不正确' })
  channelAccount?: string

  @IsOptional()
  @IsSafeText(0, 100)
  remark?: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
