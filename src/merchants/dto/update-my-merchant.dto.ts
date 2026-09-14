import { IsOptional, IsString } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class UpdateMyMerchantDto {
  @IsOptional()
  @IsSafeText(0, 50)
  merchantName?: string

  @IsOptional()
  @IsSafeText(0, 30)
  contactName?: string

  @IsOptional()
  @IsString()
  contactPhone?: string

  @IsOptional()
  @IsString()
  settleAccount?: string

  @IsOptional()
  @IsString()
  businessLicenseNo?: string
}
