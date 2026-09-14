import { IsNotEmpty, IsString } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class RejectWithdrawalDto {
  @IsSafeText(1, 200)
  reason!: string
}
