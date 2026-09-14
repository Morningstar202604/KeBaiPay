import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator'
import { IsIdCard } from '../../common/validators/id-card'

// 支付密码强度策略：6 位纯数字（与银行惯例一致），避免弱密码（如 123456、abcdef）
const PAY_PASSWORD_REGEX = /^\d{6}$/

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

  @IsString()
  @IsNotEmpty()
  @Matches(PAY_PASSWORD_REGEX, {
    message: '支付密码必须为 6 位纯数字',
  })
  payPassword!: string
}
