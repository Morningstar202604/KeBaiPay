import { IsNotEmpty, IsString } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class RejectIdentityDto {
  @IsSafeText(1, 200)
  reason!: string
}
