import { IsPayPassword } from '../../common/validators/pay-password'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class PayCashierOrderDto {
  @IsString()
  @IsNotEmpty()
  @IsPayPassword()
  payPassword!: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
