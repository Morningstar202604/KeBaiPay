import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { MerchantType } from '../../common/enums'
import { IsSafeText } from '../../common/validators/safe-text'

export class RegisterMerchantDto {
  @IsSafeText(1, 50)
  merchantName!: string

  @IsOptional()
  @IsEnum(MerchantType)
  merchantType?: MerchantType

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
