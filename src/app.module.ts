import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ServeStaticModule } from '@nestjs/serve-static'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import { join } from 'path'
import { existsSync } from 'fs'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { AccountsModule } from './accounts/accounts.module'
import { TransactionsModule } from './transactions/transactions.module'
import { TransfersModule } from './transfers/transfers.module'
import { BillsModule } from './bills/bills.module'
import { WithdrawalsModule } from './withdrawals/withdrawals.module'
import { RedPacketsModule } from './red-packets/red-packets.module'
import { QrCodesModule } from './qr-codes/qr-codes.module'
import { MerchantsModule } from './merchants/merchants.module'
import { PrismaModule } from './prisma/prisma.module'
import { CashierModule } from './cashier/cashier.module'
import { BankCardsModule } from './bank-cards/bank-cards.module'
import { EscrowModule } from './escrow/escrow.module'
import { BatchTransfersModule } from './batch-transfers/batch-transfers.module'
import { SubscriptionsModule } from './subscriptions/subscriptions.module'
import { SplitsModule } from './splits/splits.module'
import { CouponsModule } from './coupons/coupons.module'
import { ReferralsModule } from './referrals/referrals.module'
import { MessagesModule } from './messages/messages.module'
import { InvoicesModule } from './invoices/invoices.module'
import { RiskAuditModule } from './risk-audit/risk-audit.module'
import { CustomRulesModule } from './custom-rules/custom-rules.module'
import { ChannelReconciliationModule } from './channel-reconciliation/channel-reconciliation.module'
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
import { MetricsModule } from './metrics/metrics.module'
import { AgentModule } from './agent/agent.module'
import { RequestLoggingMiddleware } from './common/request-logging.middleware'
import { ScheduleHealthModule } from './common/schedule-health.module'
import { validateEnv } from './common/env-validation'

/**
 * 前端 SPA 静态托管：
 * - /portal → web/dist（商户后台 Vue 3）
 * - /h5     → web-h5/dist（用户端 H5）
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
        exclude: ['/auth/{*splat}', '/merchants/{*splat}', '/cashier/{*splat}', '/users/{*splat}', '/accounts/{*splat}'],
      }),
    )
  }
  const h5Dist = join(__dirname, '..', 'web-h5', 'dist')
  if (existsSync(h5Dist)) {
    modules.push(
      ServeStaticModule.forRoot({
        rootPath: h5Dist,
        serveRoot: '/h5',
        exclude: ['/auth/{*splat}', '/accounts/{*splat}', '/transactions/{*splat}', '/transfers/{*splat}', '/withdrawals/{*splat}', '/red-packets/{*splat}', '/bills/{*splat}', '/cashier/{*splat}', '/qr-codes/{*splat}', '/users/{*splat}'],
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
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'auth',
        ttl: 60000,
        limit: 10,
      },
      {
        name: 'open-api',
        ttl: 60000,
        limit: 30,
      },
    ]),
    ...spaStaticModules(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      // /portal 与 /h5 由 spaStaticModules 单独托管，根静态模块不拦截
      exclude: ['/portal/{*splat}', '/h5/{*splat}'],
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
    AccountsModule,
    TransactionsModule,
    TransfersModule,
    BillsModule,
    WithdrawalsModule,
    RedPacketsModule,
    QrCodesModule,
    MerchantsModule,
    CashierModule,
    BankCardsModule,
    EscrowModule,
    BatchTransfersModule,
    SubscriptionsModule,
    SplitsModule,
    CouponsModule,
    ReferralsModule,
    MessagesModule,
    InvoicesModule,
    RiskAuditModule,
    CustomRulesModule,
    ChannelReconciliationModule,
    OpenApiModule,
    AdminModule,
    FinanceModule,
    WebhooksModule,
    NotificationsModule,
    HealthModule,
    ScheduleHealthModule,
    SmsModule,
    MetricsModule,
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
