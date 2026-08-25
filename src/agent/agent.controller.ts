import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AgentAuthGuard } from './agent-auth.guard'
import { AgentService } from './agent.service'
import { AgentAuditLogService } from './agent-audit-log.service'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AgentCurrentUser } from './agent-current-user.interface'
import {
  StartConversationDto, SendMessageDto, ConfirmOpDto,
} from './dto/agent.dto'

/**
 * Agent 智能体运行时端点（需 Agent token）
 *
 * 端点分组：
 *  1. /agent/conversations   - 会话管理
 *  2. /agent/chat            - 发送消息（核心入口）
 *  3. /agent/confirm         - 确认/拒绝待确认操作
 *  4. /agent/verify-chain    - 校验操作哈希链
 *
 * 认证/授权管理（login / authorize / revoke / authorizations）见
 * AgentAuthController（用户 JWT）；创建/管理 Agent 见 AgentAdminController（管理员 JWT）。
 */
@ApiTags('AI 智能体')
@ApiBearerAuth('agent-auth')
@UseGuards(AgentAuthGuard)
@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly auditLog: AgentAuditLogService,
  ) {}

  @Post('conversations')
  @ApiOperation({ summary: '创建会话' })
  async createConversation(
    @CurrentUser() user: AgentCurrentUser,
    @Body() dto: StartConversationDto,
  ) {
    return this.agentService.createConversation(
      user.subjectId!, dto.scenario, dto.title, dto.metadata,
    )
  }

  @Get('conversations')
  @ApiOperation({ summary: '查询我的会话列表' })
  async listConversations(
    @CurrentUser() user: AgentCurrentUser,
    @Query('scenario') scenario?: string,
  ) {
    return this.agentService.listConversations(user.subjectId!, scenario)
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: '查询会话历史消息' })
  async listMessages(
    @CurrentUser() user: AgentCurrentUser,
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    return this.agentService.listMessages(id, user, limit)
  }

  @Post('conversations/:id/close')
  @ApiOperation({ summary: '关闭会话' })
  async closeConversation(
    @CurrentUser() user: AgentCurrentUser,
    @Param('id') id: string,
    @Body('summary') summary?: string,
  ) {
    return this.agentService.closeConversation(id, user, summary)
  }

  @Post('chat')
  @ApiOperation({ summary: '发送消息并获取 AI 回复（核心入口）' })
  async chat(
    @CurrentUser() user: AgentCurrentUser,
    @Body() dto: SendMessageDto,
  ) {
    if (!dto.convId) {
      throw new BadRequestException('convId 不能为空')
    }
    return this.agentService.sendMessage({
      convId: dto.convId,
      content: dto.content,
      user,
    })
  }

  @Post('confirm')
  @ApiOperation({ summary: '确认或拒绝待确认的操作（资金类）' })
  async confirmOp(
    @CurrentUser() user: AgentCurrentUser,
    @Body() dto: ConfirmOpDto,
  ) {
    return this.agentService.confirmOp({
      opLogId: dto.opLogId,
      decision: dto.decision,
      user,
    })
  }

  @Get('verify-chain/:agentId')
  @ApiOperation({ summary: '校验 Agent 操作哈希链（防篡改）' })
  async verifyChain(@Param('agentId') agentId: string) {
    return this.agentService.verifyHashChain(agentId)
  }
}
