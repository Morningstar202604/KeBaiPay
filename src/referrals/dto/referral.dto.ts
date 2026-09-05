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

/** 绑定邀请关系（被邀请人调用） */
export class BindReferralDto {
  @IsString()
  @IsNotEmpty({ message: '邀请码不能为空' })
  @MaxLength(32)
  code!: string
}

/** 列出我的邀请记录 */
export class ListReferralDto {
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'COMPLETED', 'CANCELLED'])
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

/** 取消邀请 */
export class CancelReferralDto {
  @IsString()
  @IsNotEmpty({ message: '取消原因不能为空' })
  @MaxLength(256)
  reason!: string
}

/** 手动触发奖励发放（管理后台/测试用） */
export class TriggerRewardDto {
  @IsString()
  @IsNotEmpty({ message: '触发交易号不能为空' })
  transactionNo!: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  amount?: number  // 已废弃：服务端一律以订单实际金额判定触发门槛，此字段被忽略
}
