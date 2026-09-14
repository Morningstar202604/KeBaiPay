import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

/** 买家申请退款 / 买家发起争议 */
export class EscrowReasonDto {
  @IsSafeText(1, 512)
  reason!: string
}

/** 卖家同意退款 / 管理员裁决 */
export class EscrowResolveDto {
  @IsString()
  @IsNotEmpty({ message: '决定必须明确' })
  @MaxLength(32)
  // APPROVE_REFUND（同意退款） / REJECT_REFUND（拒绝退款，资金放给卖家）
  decision!: string

  @IsOptional()
  @IsSafeText(0, 512)
  reason?: string
}
