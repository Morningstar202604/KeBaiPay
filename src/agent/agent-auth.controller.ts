import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AgentUserAuthGuard } from './agent-user-auth.guard'
import { AgentAdminAuthGuard } from './agent-admin-auth.guard'
import { AgentAuthService } from './agent-auth.service'
import { AgentService } from './agent.service'
import { CreateAgentDto, AuthorizeAgentDto, LoginAgentDto } from './dto/agent.dto'

/**
 * Agent 智能体：认证与管理端点
 *
 * 分组：
 *  - 用户自助（用户 JWT）：login / authorize / revoke / authorizations
 *  - 管理端（管理员 JWT）：创建/列出 Agent
 *
 * 说明：此前这些端点被 AgentAuthGuard（需要 agent token）保护，造成
 * "没有 token 无法换取 token"的循环，用户根本无法通过 HTTP 使用 Agent。
 * 现拆分为用户/管理员认证，解除循环。
 */
@ApiTags('AI 智能体')
@ApiBearerAuth('user-auth')
@Controller('agent')
export class AgentAuthController {
  constructor(
    private readonly agentAuthService: AgentAuthService,
    private readonly agentService: AgentService,
  ) {}

  /** 用户用自己的账号换取 Agent 长期 token（subjectId 绑定为当前登录用户） */
  @UseGuards(AgentUserAuthGuard)
  @Post('login')
  @ApiOperation({ summary: '用户换取 Agent 访问令牌' })
  async login(@Req() req: any, @Body() dto: LoginAgentDto) {
    return this.agentAuthService.login({
      agentId: dto.agentId,
      authId: dto.authId,
      // 强制绑定为当前登录用户，防止越权指定他人 subjectId
      subjectId: req.user.userId,
    })
  }

  /** 用户授权某个 Agent 代为操作（subjectId 绑定为当前登录用户） */
  @UseGuards(AgentUserAuthGuard)
  @Post('authorize')
  @ApiOperation({ summary: '用户授权 Agent 代为操作' })
  async authorize(@Req() req: any, @Body() dto: AuthorizeAgentDto) {
    return this.agentAuthService.authorize({
      agentId: dto.agentId,
      subjectType: 'user',
      subjectId: req.user.userId,
      scopes: dto.scopes,
      maxAmount: dto.maxAmount,
      expiresAt: dto.expiresAt,
    })
  }

  @UseGuards(AgentUserAuthGuard)
  @Post('revoke/:authId')
  @ApiOperation({ summary: '撤销授权' })
  async revoke(@Param('authId') authId: string) {
    return this.agentAuthService.revoke(authId)
  }

  @UseGuards(AgentUserAuthGuard)
  @Get('authorizations')
  @ApiOperation({ summary: '查询我的授权列表' })
  async listAuthorizations(@Req() req: any) {
    return this.agentAuthService.listMyAuthorizations(req.user.userId)
  }
}

/** 管理端：Agent 生命周期管理 */
@ApiTags('AI 智能体')
@ApiBearerAuth('admin-auth')
@Controller('agent/admin')
export class AgentAdminController {
  constructor(private readonly agentAuthService: AgentAuthService) {}

  @UseGuards(AgentAdminAuthGuard)
  @Post('agents')
  @ApiOperation({ summary: '创建 Agent（管理端）' })
  async createAgent(@Body() dto: CreateAgentDto) {
    return this.agentAuthService.createAgent({
      name: dto.name,
      description: dto.description,
      scenario: dto.scenario,
      scopes: dto.scopes,
    })
  }

  @UseGuards(AgentAdminAuthGuard)
  @Get('agents')
  @ApiOperation({ summary: '列出所有 Agent（管理端）' })
  async listAgents() {
    return this.agentAuthService.listAgents()
  }
}
