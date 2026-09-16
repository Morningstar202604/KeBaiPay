import { Type } from 'class-transformer'
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class TransferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  toUserId!: string

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsSafeText(0, 100)
  remark?: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
