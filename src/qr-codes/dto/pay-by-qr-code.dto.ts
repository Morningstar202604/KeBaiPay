import { IsPayPassword } from '../../common/validators/pay-password'
import { IsString, IsNumber, IsOptional, IsPositive, IsNotEmpty, Min, Max, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'
import { IsSafeText } from '../../common/validators/safe-text'

export class PayByQrCodeDto {
  @IsString()
  @IsNotEmpty()
  // 真实收款码由 generateQrCode() 生成（"KB-" 前缀，约 20 字符），64 位上限足以兼容并防滥用
  @MaxLength(64)
  code!: string

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Min(0.01)
  @Max(500000)
  @Type(() => Number)
  amount?: number

  @IsOptional()
  @IsSafeText(0, 100)
  remark?: string

  @IsString()
  @IsNotEmpty()
  @IsPayPassword()
  payPassword!: string

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
