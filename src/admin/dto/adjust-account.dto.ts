import { IsNotEmpty, IsNumber, IsString } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

export class AdjustAccountDto {
  @IsNumber()
  amount!: number

  @IsSafeText(1, 200)
  reason!: string
}
