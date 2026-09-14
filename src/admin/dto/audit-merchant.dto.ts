import { IsIn, IsOptional, IsString } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class AuditMerchantDto {
  @IsIn(['APPROVE', 'REJECT'])
  action!: 'APPROVE' | 'REJECT'

  @IsOptional()
  @IsSafeText(0, 200)
  reason?: string
}
