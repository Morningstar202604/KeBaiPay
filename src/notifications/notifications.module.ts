import { Module, Global } from '@nestjs/common'
import { MailerModule } from '@nestjs-modules/mailer'
import { ConfigService } from '@nestjs/config'
import { NotificationsService } from './notifications.service'
import { SettlementService } from './settlement.service'
import { SettlementSchedule } from './settlement.schedule'
import { PrismaModule } from '../prisma/prisma.module'

@Global()
@Module({
  imports: [
    PrismaModule,
    // NestJS 12 + @nestjs-modules/mailer 2.3.7：MailerAsyncOptions 继承
    // Pick<ModuleMetadata, 'imports'>，要求必须提供 imports 字段；同时 nodemailer
    // 10 与 @types/nodemailer 8 的 transport 类型存在结构差异，这里显式收敛
    // useFactory 返回类型并补 imports: [] 即可通过类型检查。
    MailerModule.forRootAsync({
      imports: [],
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailerOptionsShape => {
        const transport = {
          host: config.get<string>('SMTP_HOST', 'smtp.ethereal.email'),
          port: config.get<number>('SMTP_PORT', 587),
          secure: false,
          auth: {
            user: config.get<string>('SMTP_USER', ''),
            pass: config.get<string>('SMTP_PASS', ''),
          },
        }
        const defaults = {
          from: config.get<string>('SMTP_FROM', 'KeBaiPay <noreply@kebaipay.com>'),
        }
        return { transport, defaults }
      },
    }),
  ],
  providers: [NotificationsService, SettlementService, SettlementSchedule],
  exports: [NotificationsService, SettlementService],
})
export class NotificationsModule {}

/** useFactory 返回值的结构化描述（transport 用 nodemailer TransportOptions 兼容形态） */
type MailerOptionsShape = {
  transport: {
    host: string
    port: number
    secure: boolean
    auth: { user: string; pass: string }
  }
  defaults: { from: string }
}
