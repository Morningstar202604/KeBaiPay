import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { SmsService } from './sms.service';
import { SendCodeDto, VerifyCodeDto } from './dto/sms.dto';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * 发送验证码
   * POST /sms/send
   * 无需登录态（注册/登录/重置密码场景需在登录前调用），
   * 防轰炸靠手机号 + IP 双维度限流（在 SmsService 内基于 Redis 实现）。
   * 格式校验由 SendCodeDto + 全局 ValidationPipe 完成。
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendCode(@Body() dto: SendCodeDto, @Req() req: Request) {
    // 直接用 req.ip：main.ts 已设 trust proxy 1，Express 会自动从 X-Forwarded-For
    // 取信任代理追加的最后一个 IP（即真实客户端 IP）。
    // 不要手动取 X-Forwarded-For 首值，否则攻击者可伪造该头绕过 IP 限流。
    return this.smsService.sendVerificationCode(dto.phone, dto.scene ?? 'login', req.ip);
  }

  /**
   * 验证码校验
   * POST /sms/verify
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyCode(@Body() dto: VerifyCodeDto) {
    return await this.smsService.verifyCode(dto.phone, dto.code, dto.scene ?? 'login');
  }

  /**
   * 获取短信配置状态
   * GET /sms/config
   */
  @Get('config')
  getConfig() {
    return this.smsService.getConfigStatus();
  }
}
