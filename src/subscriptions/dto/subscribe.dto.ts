import {
  IsString,
  IsOptional,
  IsNotEmpty,
  MaxLength,
} from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

/** 订阅计划 */
export class SubscribeDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  payPassword!: string
}

/** 取消订阅 */
export class CancelSubscriptionDto {
  @IsOptional()
  @IsSafeText(0, 256)
  reason?: string
}
