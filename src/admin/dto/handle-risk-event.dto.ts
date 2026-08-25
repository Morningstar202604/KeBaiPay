import { IsOptional, IsString, MaxLength } from 'class-validator'

/** 处置风控事件：可选处置说明（追加到事件描述，供审计追溯） */
export class HandleRiskEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string
}
