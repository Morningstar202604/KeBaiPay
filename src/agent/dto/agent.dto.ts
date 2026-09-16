import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsInt, Min, MaxLength } from 'class-validator'
import { AGENT_SCENARIOS } from '../../common/constants'
import { IsSafeText } from '../../common/validators/safe-text'

/** 创建智能体 */
export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string

  @IsString()
  @IsOptional()
  description?: string

  @IsIn(AGENT_SCENARIOS as readonly string[])
  @MaxLength(64)
  scenario!: string

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[]
}

/** 更新智能体 */
export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  name?: string

  @IsString()
  @IsOptional()
  description?: string

  @IsIn(['ACTIVE', 'DISABLED'])
  @IsOptional()
  status?: string

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[]
}

/** 用户授权智能体 */
export class AuthorizeAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  agentId!: string

  @IsArray()
  @IsString({ each: true })
  scopes!: string[]

  @IsInt()
  @Min(0)
  @IsOptional()
  maxAmount?: number

  @IsOptional()
  expiresAt?: Date
}

/** 用户换取 Agent 访问令牌 */
export class LoginAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  agentId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  authId!: string
}

/** 发起对话 */
export class StartConversationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  scenario!: string

  @IsOptional()
  @IsSafeText(0, 64)
  title?: string

  @IsOptional()
  metadata?: Record<string, unknown>
}

/** 发送消息 */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string

  @IsString()
  @IsOptional()
  convId?: string
}

/** 确认/拒绝操作 */
export class ConfirmOpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  opLogId!: string

  @IsIn(['CONFIRM', 'REJECT'])
  decision!: 'CONFIRM' | 'REJECT'
}
