import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator'

/** 短信验证码场景（与 SmsService 的 scene 参数保持一致） */
export const SMS_SCENES = ['register', 'login', 'reset', 'bind'] as const

/**
 * 发送验证码
 *
 * 防轰炸由 SmsService 内基于 Redis 的「手机号+场景」与 IP 双维限流负责，
 * DTO 只负责格式约束，保证非法输入在管道层被 400 拒绝而不是进入业务层。
 */
export class SendCodeDto {
  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string

  @IsOptional()
  @IsEnum(SMS_SCENES, { message: '无效的验证码场景' })
  scene?: (typeof SMS_SCENES)[number]
}

/** 校验验证码 */
export class VerifyCodeDto {
  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string

  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  // 验证码固定 6 位数字（见 sms.service generateCode：randomInt(100000, 1000000)）
  @Matches(/^\d{6}$/, { message: '验证码格式不正确' })
  code!: string

  @IsOptional()
  @IsEnum(SMS_SCENES, { message: '无效的验证码场景' })
  scene?: (typeof SMS_SCENES)[number]
}
