import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator'
import { IsIdCard } from '../../common/validators/id-card'
import { IsPayPassword } from '../../common/validators/pay-password'

export class VerifyIdentityDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(30)
  realName!: string

  // GB 11643 校验位 + 日期合法性校验；格式合法 ≠ 号码真实存在，
  // 姓名与号码的对应关系由实名核验服务或人工审核确认
  @IsString()
  @IsNotEmpty()
  @IsIdCard()
  idCard!: string

  @IsPayPassword()
  payPassword!: string
}
