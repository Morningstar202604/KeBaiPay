import { IsString, IsOptional, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

// 登录密码强度策略：至少 8 位，必须包含大写字母、小写字母、数字中至少两类。
// 采用正向断言组合，覆盖 (小写+大写) | (小写+数字) | (大写+数字) 三种满足条件。
const LOGIN_PASSWORD_REGEX =
  /^(?:(?=.*[a-z])(?=.*[A-Z])|(?=.*[a-z])(?=.*\d)|(?=.*[A-Z])(?=.*\d)).{8,64}$/

export class RegisterDto {
  @IsSafeText(1, 32)
  nickname!: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string

  @IsString()
  @IsNotEmpty()
  @Matches(LOGIN_PASSWORD_REGEX, {
    message: '密码至少 8 位，且必须包含大写字母、小写字母、数字中的至少两类',
  })
  password!: string

  // 短信验证码：仅在服务端配置了真实短信渠道（SMS_PROVIDER 非 mock）且用手机号注册时必填，
  // 未配置短信服务时无需携带 —— 见 auth.service.register 的分支逻辑
  @IsOptional()
  @IsString()
  @MaxLength(8)
  smsCode?: string
}
