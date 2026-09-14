import { Type } from 'class-transformer'
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class CreateCashierOrderDto {
  @IsString()
  @IsNotEmpty()
  merchantOrderNo!: string

  @IsNumber()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount!: number

  @IsSafeText(1, 64)
  subject!: string

  @IsOptional()
  @IsString()
  body?: string

  @IsOptional()
  @IsString()
  callbackUrl?: string

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiredAt?: Date
}
