import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ServeStaticModule } from '@nestjs/serve-static'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import {
  AUTH_THROTTLE_LIMIT,
  AUTH_THROTTLE_TTL_MS,
  OPEN_API_THROTTLE_LIMIT,
  OPEN_API_THROTTLE_TTL_MS,
  GLOBAL_THROTTLE_LIMIT,
  GLOBAL_THROTTLE_TTL_MS,
} from './common/constants'
import { join } from 'path'
import { existsSync } from 'fs'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
// 合规聚合模式：以下资金池模块已下线（无证经营支付业务红线，见 docs/COMPLIANCE_MODE.md）
// AccountsModule / TransactionsModule / TransfersModule / WithdrawalsModule /
// RedPacketsModule / EscrowModule / BatchTransfersModule —— 全部不注册
import { BillsModule } from './bills/bills.module'
import { QrCodesModule } from './qr-codes/qr-codes.module'
import { MerchantsModule } from './merchants/merchants.module'
import { PrismaModule } from './prisma/prisma.module'
import { CashierModule } from './cashier/cashier.module'
// SubscriptionsModule（订阅自动扣费）已下线：扣费为平台内资金划转，聚合模式下
// 需持牌机构签约代扣，超出平台职责（见 docs/COMPLIANCE_MODE.md）
// SplitsModule（任务分账）已下线：分账属资金操作，聚合模式下应由持牌通道侧分账能力完成
import { CouponsModule } from './coupons/coupons.module'
// ReferralsModule（邀请返利）已下线：返利入平台余额，聚合模式无余额，返利应由商户结算侧完成
import { MessagesModule } from './messages/messages.module'
import { InvoicesModule } from './invoices/invoices.module'
import { OpenApiModule } from './open-api/open-api.module'
import { AdminModule } from './admin/admin.module'
import { FinanceModule } from './finance/finance.module'
import { RedisModule } from './redis/redis.module'
import { PaymentChannelsModule } from './payment-channels/payment-channels.module'
import { WebhooksModule } from './webhooks/webhooks.module'
import { CryptoModule } from './crypto/crypto.module'
import { SecurityModule } from './security/security.module'
import { RiskModule } from './risk/risk.module'
import { AuditModule } from './audit/audit.module'
import { HealthModule } from './health/health.module'
import { NotificationsModule } from './notifications/notifications.module'
import { SmsModule } from './sms/sms.module'
import { AgentModule } from './agent/agent.module'
import { RequestLoggingMiddleware } from './common/request-logging.middleware'
import { ScheduleHealthModule } from './common/schedule-health.module'
import { validateEnv } from './common/env-validation'

/**
 * 前端 SPA 静态托管：
 * - /portal → web/dist（商户后台 Vue 3）
 * - /h5     → web-h5/dist（用户端 H5）
 * - /admin  → web-admin/dist（管理后台 Vue 3）
 * 仅当对应 dist 已构建时才注册，避免本地未构建导致启动失败。
 */
function spaStaticModules() {
  const modules = []
  const portalDist = join(__dirname, '..', 'web', 'dist')
  if (existsSync(portalDist)) {
    modules.push(
      ServeStaticModule.forRoot({
        rootPath: portalDist,
        serveRoot: '/portal',
        exclude: ['/auth/{*splat}', '/merchants/{*splat}', '/cashier/{*splat}', '/users/{*splat}'],
      }),
    )
  }
  const h5Dist = join(__dirname, '..', 'web-h5', 'dist')
  if (existsSync(h5Dist)) {
    modules.push(
      ServeStaticModule.forRoot({
        rootPath: h5Dist,
        serveRoot: '/h5',
        exclude: ['/auth/{*splat}', '/bills/{*splat}', '/cashier/{*splat}', '/qr-codes/{*splat}', '/users/{*splat}'],
      }),
    )
  }
  const adminDist = join(__dirname, '..', 'web-admin', 'dist')
  if (existsSync(adminDist)) {
    modules.push(
      ServeStaticModule.forRoot({
        rootPath: adminDist,
        serveRoot: '/admin',
        exclude: ['/admin/auth/{*splat}', '/admin/dashboard/{*splat}', '/admin/users/{*splat}', '/admin/merchants/{*splat}', '/admin/payment-orders/{*splat}', '/admin/risk-events/{*splat}', '/admin/finance/{*splat}', '/admin/login-logs/{*splat}', '/admin/system-config/{*splat}', '/admin/system-config', '/admin/risk-rules/{*splat}', '/admin/identity/{*splat}', '/admin/audit-logs/{*splat}', '/admin/admin-users/{*splat}', '/admin/channels/{*splat}', '/admin/reconciliation/{*splat}', '/agent/{*splat}'],
      }),
    )
  }
  return modules
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: GLOBAL_THROTTLE_TTL_MS,
        limit: GLOBAL_THROTTLE_LIMIT,
      },
      {
        name: 'auth',
        ttl: AUTH_THROTTLE_TTL_MS,
        limit: AUTH_THROTTLE_LIMIT,
      },
      {
        name: 'open-api',
        ttl: OPEN_API_THROTTLE_TTL_MS,
        limit: OPEN_API_THROTTLE_LIMIT,
      },
    ]),
    ...spaStaticModules(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      // /portal、/h5、/admin 由 spaStaticModules 单独托管，根静态模块不拦截
      exclude: ['/portal/{*splat}', '/h5/{*splat}', '/admin/{*splat}', '/agent/{*splat}'],
    }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    SecurityModule,
    RiskModule,
    AuditModule,
    PaymentChannelsModule,
    AuthModule,
    UsersModule,
    BillsModule,
    QrCodesModule,
    MerchantsModule,
    CashierModule,
    CouponsModule,
    MessagesModule,
    InvoicesModule,
    OpenApiModule,
    AdminModule,
    FinanceModule,
    WebhooksModule,
    NotificationsModule,
    HealthModule,
    ScheduleHealthModule,
    SmsModule,
    AgentModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggingMiddleware)
      .forRoutes('*')
  }
}
