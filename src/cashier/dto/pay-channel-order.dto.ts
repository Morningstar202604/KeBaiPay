import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * 渠道支付请求 DTO（合规聚合模式：用户通过微信/支付宝直接付款）
 */
export class PayChannelOrderDto {
  /** 支付渠道：alipay / wechat（mock 仅限开发环境） */
  @IsString()
  @IsIn(['alipay', 'wechat', 'mock'])
  channel!: string

  /** 支付方式：native/JSAPI/h5/page/wap（可选，缺省按渠道默认） */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  payMethod?: string

  /** 客户端真实 IP（微信 H5 支付要求） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientIp?: string
}
