import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

export class AdminLoginDto {
  // 长度上限对齐 CreateAdminUserDto 的用户名规则（4-20 位），放宽到 32 兼容历史账号
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  username!: string

  // bcrypt 只取前 72 字节，超长密码徒增哈希输入体积；上限对齐用户侧登录 64 位
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(64)
  password!: string
}
