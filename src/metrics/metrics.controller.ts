import { Controller, Get, Header, HttpCode, HttpStatus, Req, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'
import { SkipThrottle } from '@nestjs/throttler'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { createHash, timingSafeEqual } from 'crypto'
import { MetricsService } from './metrics.service'

/**
 * Prometheus 指标暴露端点
 *
 * /metrics 返回 Prometheus 文本格式指标，供 Prometheus server 定期抓取。
 * @SkipThrottle 避免抓取被限流；不经过 ResponseTransformInterceptor 包装，
 * 直接返回纯文本，否则会破坏 Prometheus 解析。
 *
 * 访问控制：配置 METRICS_TOKEN 后，抓取方必须携带
 * `Authorization: Bearer <METRICS_TOKEN>`（Prometheus 原生支持 bearer_token）。
 * 未配置时保持开放（内网部署场景），生产环境建议同时启用 token 与反代限制。
 */
@ApiTags('可观测性')
@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus 指标（供 Prometheus server 抓取）' })
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Req() req: Request): Promise<string> {
    const expected = this.configService.get<string>('METRICS_TOKEN')
    if (expected) {
      const auth = req.headers.authorization || ''
      // L1 修复：哈希后常量时间比较，避免逐字节短路泄露前缀匹配长度
      const providedHash = createHash('sha256').update(auth).digest()
      const expectedHash = createHash('sha256')
        .update(`Bearer ${expected}`)
        .digest()
      if (!timingSafeEqual(providedHash, expectedHash)) {
        throw new UnauthorizedException('metrics token invalid')
      }
    }
    return this.metricsService.metrics()
  }
}
