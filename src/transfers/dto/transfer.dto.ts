import { IsString, IsNumber, IsOptional, IsPositive, IsNotEmpty, Min, Max, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'
import { IsSafeText } from '../../common/validators/safe-text'
import { IsPayPassword } from '../../common/validators/pay-password'

export class TransferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  toUserId!: string

  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsSafeText(0, 100)
  remark?: string

  @IsPayPassword()
  payPassword!: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
