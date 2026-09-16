import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  MaxLength,
} from 'class-validator'
import { Type } from 'class-transformer'
import { IsSafeText } from '../../common/validators/safe-text'

/** 创建发票申请 */
export class CreateInvoiceDto {
  @IsString()
  @IsIn(['NORMAL', 'SPECIAL'])
  @MaxLength(64)
  type!: string

  @IsSafeText(1, 128)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  taxNo?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankName?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankAccount?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  address?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @IsInt()
  @Min(1, { message: '发票金额必须大于 0' })
  @Type(() => Number)
  amount!: number  // 单位：分

  @IsOptional()
  @IsSafeText(0, 256)
  remark?: string
}

/** 查询发票列表 */
export class ListInvoiceDto {
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'ISSUED', 'CANCELLED'])
  status?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number
}
