import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateMerchantAppDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string

  @IsOptional()
  @IsString()
  callbackUrl?: string
}
