import { Module } from '@nestjs/common'
import { CashierService } from './cashier.service'
import { CashierSchedule } from './cashier.schedule'
import { CashierController, CashierQrCodeController } from './cashier.controller'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [CashierService, CashierSchedule],
  controllers: [CashierController, CashierQrCodeController],
  // 导出 CashierService 供 WebhooksModule 处理收单支付回调时通知商户
  exports: [CashierService],
})
export class CashierModule {}
