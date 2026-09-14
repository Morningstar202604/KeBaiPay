import { IsEnum, IsOptional, IsString } from 'class-validator'
import { UserStatus } from '../../common/enums'
import { IsSafeText } from '../../common/validators/safe-text'

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus

  @IsOptional()
  @IsSafeText(0, 200)
  reason?: string
}
