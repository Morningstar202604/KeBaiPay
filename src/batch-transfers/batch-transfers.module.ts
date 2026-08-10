import { Module } from '@nestjs/common'
import { BatchTransfersService } from './batch-transfers.service'
import { BatchTransfersController } from './batch-transfers.controller'
import { BatchTransfersSchedule } from './batch-transfers.schedule'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [UsersModule],
  providers: [BatchTransfersService, BatchTransfersSchedule],
  controllers: [BatchTransfersController],
  exports: [BatchTransfersService],
})
export class BatchTransfersModule {}
