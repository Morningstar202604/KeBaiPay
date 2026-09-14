import { Type } from 'class-transformer'
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class RefundDto {
  @IsString()
  @IsNotEmpty()
  orderNo!: string

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount?: number

  @IsOptional()
  @IsSafeText(0, 200)
  reason?: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
