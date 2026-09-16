import { IsPayPassword } from '../../common/validators/pay-password'
import {
  IsArray,
  IsNumber,
  IsString,
  IsOptional,
  IsPositive,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { IsSafeText } from '../../common/validators/safe-text'

/** 批量转账单个明细 */
export class BatchTransferItemDto {
  @IsString()
  @IsNotEmpty({ message: '收款方 ID 不能为空' })
  toUserId!: string

  @IsNumber()
  @IsPositive({ message: '明细金额必须大于 0' })
  @Min(0.01, { message: '明细金额必须大于 0' })
  @Max(5000, { message: '单笔明细金额上限 5000 元' })
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsSafeText(0, 128)
  remark?: string
}

/** 提交批量转账 */
export class CreateBatchTransferDto {
  @IsArray()
  @ArrayMinSize(1, { message: '至少包含 1 笔明细' })
  @ArrayMaxSize(500, { message: '单批次明细数上限 500 笔' })
  @ValidateNested({ each: true })
  @Type(() => BatchTransferItemDto)
  items!: BatchTransferItemDto[]

  @IsOptional()
  @IsSafeText(0, 256)
  remark?: string

  @IsString()
  @IsNotEmpty({ message: '支付密码不能为空' })
  @MaxLength(64)
  @IsPayPassword()
  payPassword!: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string
}
