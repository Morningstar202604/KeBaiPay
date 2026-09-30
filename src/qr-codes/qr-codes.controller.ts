import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CurrentUser as CurrentUserType } from '../auth/current-user.interface'
import { QrCodesService } from './qr-codes.service'
import { CreateFixedCodeDto } from './dto/create-fixed-code.dto'

@ApiTags('收款码')
@ApiBearerAuth('user-auth')
@Controller('qr-codes')
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @UseGuards(JwtAuthGuard)
  @Get('personal')
  @ApiOperation({ summary: '获取个人收款码', description: '获取或创建个人动态收款码' })
  @ApiResponse({ status: 200, description: '返回收款码信息' })
  getPersonalCode(@CurrentUser() user: CurrentUserType) {
    return this.qrCodesService.getPersonalCode(user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Post('fixed')
  @ApiOperation({ summary: '创建固定金额收款码', description: '创建指定金额的静态收款码' })
  @ApiResponse({ status: 201, description: '收款码创建成功' })
  createFixedCode(@CurrentUser() user: CurrentUserType, @Body() dto: CreateFixedCodeDto) {
    return this.qrCodesService.createFixedCode(user.id, dto)
  }

  // POST /qr-codes/pay（扫码付款）已下线：合规聚合模式下平台无余额，
  // 收款码仅作为收单入口，付款一律走收银台渠道支付（/cashier/orders/:orderNo/channel-pay）
}
