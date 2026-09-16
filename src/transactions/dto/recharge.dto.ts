import { IsNumber, IsOptional, IsPositive, Min, Max, IsString, IsNotEmpty } from 'class-validator'
import { Type } from 'class-transformer'
import { IsPayPassword } from '../../common/validators/pay-password'

export class RechargeDto {
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
  idempotencyKey?: string
}
