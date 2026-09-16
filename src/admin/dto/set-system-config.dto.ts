import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class SetSystemConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  key!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  value!: string
}
