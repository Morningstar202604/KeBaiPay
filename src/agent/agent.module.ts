import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AgentController } from './agent.controller'
import { AgentAuthController, AgentAdminController } from './agent-auth.controller'
import { AgentService } from './agent.service'
import { AgentAuthService } from './agent-auth.service'
import { AgentAuthGuard } from './agent-auth.guard'
import { AgentUserAuthGuard } from './agent-user-auth.guard'
import { AgentAdminAuthGuard } from './agent-admin-auth.guard'
import { AgentAuditLogService } from './agent-audit-log.service'
import { ToolRegistry } from './tools/tool.registry'
import { LlmModule } from './llm/llm.module'
import { MessagesModule } from '../messages/messages.module'
import { CouponsModule } from '../coupons/coupons.module'
import { TransfersModule } from '../transfers/transfers.module'
import { AgentSchedule } from './agent.schedule'

/**
 * Agent 智能体模块（v2.1.0 新增）
 *
 * 第 4 种认证：AgentAuthGuard，独立 JWT_AGENT_SECRET
 * 依赖：LlmModule（@Global）、MessagesModule、CouponsModule
 *
 * 设计：
 *  - 不依赖 Passport，自包含 CanActivate（仿 AdminJwtAuthGuard）
 *  - LLM 调用走 LlmService，mock 模式降级
 *  - 工具调用走 ToolRegistry
 *  - 资金操作强制二次确认（写入 AgentOperationLog PENDING_CONFIRM）
 *  - AgentSchedule 注册到 ScheduleHealthService 被 AI 巡检自身监控
 *  - MCP 外部接入已移除（外部 AI Agent 直连支付能力风险大于收益，见重构方案 L4）
 */
@Module({
  imports: [
    ConfigModule,
    LlmModule,
    MessagesModule,
    CouponsModule,
    TransfersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_AGENT_SECRET')!,
        signOptions: {
          expiresIn: config.get<string>('JWT_AGENT_EXPIRES_IN', '7d') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AgentService,
    AgentAuthService,
    AgentAuthGuard,
    AgentUserAuthGuard,
    AgentAdminAuthGuard,
    AgentAuditLogService,
    ToolRegistry,
    AgentSchedule,
  ],
  controllers: [AgentController, AgentAuthController, AgentAdminController],
  exports: [AgentService, AgentAuthService, AgentAuditLogService],
})
export class AgentModule {}
