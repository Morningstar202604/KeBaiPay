import { Controller, Headers, Param, Post, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { Request } from 'express'
import { WebhooksService } from './webhooks.service'

type RawBodyRequest = Request & {
  rawBody?: Buffer | string
}

/**
 * Webhook 回调由外部支付渠道调用，负载格式由各渠道决定，字段不受控制。
 * 因此这里不使用 @Body()（避免全局 ValidationPipe 的 whitelist 剥离/拒绝外部字段），
 * 一律从 req.rawBody（rawBody: true 已启用）读取原始负载，验签与解析在渠道层完成。
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
  ) {}

  private resolveRawBody(req: RawBodyRequest): string {
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8')
    if (typeof req.rawBody === 'string') return req.rawBody
    return JSON.stringify(req.body ?? {})
  }

  @Post('recharge/:channel')
  @ApiOperation({ summary: '充值回调', description: '支付渠道回调通知（由渠道服务器调用）' })
  @ApiResponse({ status: 200, description: '处理成功' })
  async rechargeCallback(
    @Param('channel') channel: string,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest,
  ) {
    return this.webhooksService.handleRechargeCallback(channel, this.resolveRawBody(req), headers)
  }

  @Post('payout/:channel')
  @ApiOperation({ summary: '代付回调', description: '代付渠道回调通知' })
  @ApiResponse({ status: 200, description: '处理成功' })
  async payoutCallback(
    @Param('channel') channel: string,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest,
  ) {
    return this.webhooksService.handlePayoutCallback(channel, this.resolveRawBody(req), headers)
  }

  @Post('refund/:channel')
  @ApiOperation({ summary: '退款回调', description: '退款渠道回调通知' })
  @ApiResponse({ status: 200, description: '处理成功' })
  async refundCallback(
    @Param('channel') channel: string,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest,
  ) {
    return this.webhooksService.handleRefundCallback(channel, this.resolveRawBody(req), headers)
  }
}
