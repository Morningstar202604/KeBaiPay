import { Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'
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
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
