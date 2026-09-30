import { Module } from '@nestjs/common'
import { WebhooksController } from './webhooks.controller'
import { WebhooksService } from './webhooks.service'
// 合规聚合模式：充值/代付回调已下线（资金池功能移除），仅保留收单支付与退款回调
import { PaymentChannelsModule } from '../payment-channels/payment-channels.module'
import { PrismaModule } from '../prisma/prisma.module'
import { RedisModule } from '../redis/redis.module'
import { CashierModule } from '../cashier/cashier.module'

@Module({
  imports: [
    PaymentChannelsModule,
    PrismaModule,
    RedisModule,
    CashierModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
