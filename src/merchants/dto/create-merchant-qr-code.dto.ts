import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class CreateMerchantQrCodeDto {
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsSafeText(0, 100)
  remark?: string
}
