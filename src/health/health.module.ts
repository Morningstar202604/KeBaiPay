import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'
import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'
import { MetricsInterceptor } from './metrics.interceptor'
import { PaymentChannelsModule } from '../payment-channels/payment-channels.module'

@Module({
  imports: [
    PaymentChannelsModule,
    // /health/schedules、/health/channels 诊断端点挂 AdminJwtAuthGuard（v0.2.2），
    // 守卫需要 JwtService：与其他管理端模块一致，使用已校验的 JWT_ADMIN_SECRET
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ADMIN_SECRET')!,
        signOptions: {
          expiresIn: config.get<string>('JWT_ADMIN_EXPIRES_IN', '1h') as NonNullable<JwtModuleOptions['signOptions']>['expiresIn'],
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    HealthService,
    MetricsService,
    // 全局拦截器：所有 HTTP 请求自动采集指标（原 metrics 模块合并于此）
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class HealthModule {}
