import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator'
import { AdminRole, AdminStatus } from '../../common/enums'
import { IsSafeText } from '../../common/validators/safe-text'

export class CreateAdminUserDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_]{4,20}$/, {
    message: '用户名只能包含字母、数字和下划线，长度 4-20 位',
  })
  username!: string

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(64, { message: '密码长度不能超过 64 位' })
  password!: string

  @IsEnum(AdminRole, { message: '无效的角色类型' })
  role!: AdminRole

  @IsOptional()
  @IsSafeText(0, 32)
  nickname?: string
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsSafeText(0, 32)
  nickname?: string

  @IsOptional()
  @IsEnum(AdminRole, { message: '无效的角色类型' })
  role?: AdminRole

  @IsOptional()
  @IsEnum(AdminStatus, { message: '无效的状态' })
  status?: AdminStatus
}

export class ResetAdminPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(64, { message: '密码长度不能超过 64 位' })
  newPassword!: string
}

export class ChangeAdminPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  oldPassword!: string

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: '密码长度不能少于 8 位' })
  @MaxLength(64, { message: '密码长度不能超过 64 位' })
  newPassword!: string
}

export class ListAdminUsersQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string

  @IsOptional()
  @IsEnum(AdminRole, { message: '无效的角色类型' })
  role?: AdminRole

  @IsOptional()
  @IsEnum(AdminStatus, { message: '无效的状态' })
  status?: AdminStatus

  @IsOptional()
  page?: number

  @IsOptional()
  limit?: number
}
