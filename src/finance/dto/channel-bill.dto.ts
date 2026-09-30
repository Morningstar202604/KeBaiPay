import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator'

export class RunChannelReconciliationDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 需为 YYYY-MM-DD' })
  date!: string

  @IsOptional()
  @IsIn(['alipay', 'wechat', 'mock'])
  channel?: 'alipay' | 'wechat' | 'mock'

  // 账单来源：mock=模拟演练（缺省）| official=官方账单文件核对
  @IsOptional()
  @IsIn(['mock', 'official'])
  billSource?: 'mock' | 'official'

  // official 模式必传：官方账单文件文本（微信/支付宝 CSV）
  @IsOptional()
  @IsString()
  billText?: string

  // 差异注入（仅模拟演练用，缺省 0 = 完全匹配）
  @IsOptional()
  @IsInt()
  @Min(0)
  missingPlatformOrders?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  extraChannelOrders?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  amountMismatchOrders?: number
}

export class ChannelBillChecksQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string

  @IsOptional()
  @IsString()
  endDate?: string

  @IsOptional()
  @IsIn(['alipay', 'wechat', 'mock'])
  channel?: string
}
