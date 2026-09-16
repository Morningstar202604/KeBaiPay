import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator'
import { IsIdCard } from '../../common/validators/id-card'
import { IsPayPassword } from '../../common/validators/pay-password'

export class ResetPayPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(30)
  realName!: string

  // 与服务端 resetPayPassword 的库内比对保持一致：先按 GB 11643 校验格式，
  // 再由 usersService 比对库中已实名留存的姓名+号码，两者都通过才允许重置
  @IsString()
  @IsNotEmpty()
  @IsIdCard()
  idCard!: string

  @IsPayPassword()
  newPayPassword!: string
}
