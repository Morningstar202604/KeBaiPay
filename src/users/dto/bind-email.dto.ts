import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator'

/** 绑定/换绑邮箱：前端 /users/bind-email 调用 */
export class BindEmailDto {
  @IsString()
  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string

  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  // 短信/邮件验证码固定 6 位数字（见 sms.service generateCode）
  @Matches(/^\d{6}$/, { message: '验证码格式不正确' })
  code!: string
}
