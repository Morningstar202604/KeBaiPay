import { Injectable, Logger, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { LlmTool } from '../llm/llm.service'
import type { AgentCurrentUser } from '../agent-current-user.interface'
import { kbError, KBErrorCodes } from '../../common/error-codes'
import { fenToYuan } from '../../common/helpers'

/**
 * 工具注册表：
 *  - 统一管理所有 Agent 可调用的工具
 *  - 工具按场景分组（wallet / merchant / risk / support）
 *    wallet 为 C 端收单客户场景（历史命名，原"钱包管家"，现提供订单查询/账单等收单服务）
 *
 * 工具实现原则：
 *  1. 只读类工具直接执行（query_order、query_bill 等）
 *  2. 写入类工具先写 AgentOperationLog（PENDING_CONFIRM），再由用户确认后执行
 *  3. 工具执行依赖 Agent 上下文（subjectId/scopes/authScopes），从闭包传入
 */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按场景获取可用工具列表
   * @param ctx Agent 上下文（subjectId / authScopes 等）
   * @param scenario 场景：wallet / merchant / risk / support
   */
  getTools(ctx: AgentCurrentUser, scenario: string, deps: ToolDeps): LlmTool[] {
    const tools: LlmTool[] = []
    if (scenario === 'wallet') {
      tools.push(...this.walletTools(ctx, deps))
    } else if (scenario === 'merchant') {
      tools.push(...this.merchantTools(ctx, deps))
    } else if (scenario === 'risk') {
      tools.push(...this.riskTools(ctx, deps))
    } else if (scenario === 'support') {
      tools.push(...this.walletTools(ctx, deps), ...this.merchantTools(ctx, deps))
    }
    return tools
  }

  /** 校验 scope 权限 */
  private checkScope(ctx: AgentCurrentUser, requiredScope: string) {
    const allowed = (ctx.authScopes ?? ctx.scopes ?? []).includes(requiredScope)
    if (!allowed) {
      throw new ForbiddenException(kbError(KBErrorCodes.AGENT_SCOPE_DENIED, `缺少 scope: ${requiredScope}`))
    }
  }

  /** 校验 subjectId 非空（防止 Token 缺失 subjectId 时的越权） */
  private requireSubjectId(ctx: AgentCurrentUser): string {
    if (!ctx.subjectId) {
      throw new ForbiddenException(kbError(KBErrorCodes.AGENT_AUTHORIZATION_REVOKED, '智能体未绑定用户主体'))
    }
    return ctx.subjectId
  }

  /** 校验金额（元）：非负、有限、且不超过 Agent 单笔限额（分） */
  private validateAmountYuan(amount: any): number {
    const n = Number(amount)
    if (!Number.isFinite(n) || n < 0.01) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '金额必须为不小于 0.01 的正数'))
    }
    // Agent 专项限额：AGENT_MAX_AMOUNT_PER_OP（分），默认 500 元
    const maxPerOpFen = Number(process.env.AGENT_MAX_AMOUNT_PER_OP) || 50000
    if (Math.round(n * 100) > maxPerOpFen) {
      throw new BadRequestException(
        kbError(KBErrorCodes.INVALID_PARAMETER, `单笔金额不能超过智能体限额 ${fenToYuan(maxPerOpFen)} 元`),
      )
    }
    return n
  }

  /** 限制字符串长度，防止 DoS / 存储膨胀 */
  private truncate(str: any, max: number): string {
    if (typeof str !== 'string') return ''
    return str.slice(0, max)
  }

  /** ========== C 端收单客户工具（合规聚合模式：无钱包余额，改为订单统计） ========== */
  private walletTools(ctx: AgentCurrentUser, deps: ToolDeps): LlmTool[] {
    return [
      {
        name: 'kbpay_query_orders',
        description: '查询我作为付款方的收单订单统计（成功笔数/金额）',
        inputSchema: { type: 'object', properties: {} },
        requireConfirm: false,
        execute: async () => {
          this.checkScope(ctx, 'wallet:read')
          const subjectId = this.requireSubjectId(ctx)
          const agg = await this.prisma.paymentOrder.aggregate({
            where: { payerId: subjectId, status: 'PAID' },
            _count: { id: true },
            _sum: { amount: true },
          })
          return {
            paidCount: agg._count.id || 0,
            paidAmountYuan: fenToYuan(agg._sum.amount || 0),
          }
        },
      },
      {
        name: 'kbpay_query_bill',
        description: '查询我的收单支付订单列表（最近 N 天）',
        inputSchema: {
          type: 'object',
          properties: {
            days: { type: 'number', description: '查询最近多少天，默认 30，最大 365' },
            limit: { type: 'number', description: '返回条数，默认 20' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:read')
          const subjectId = this.requireSubjectId(ctx)
          const days = Math.min(Math.max(1, Number(args?.days) || 30), 365)
          const limit = Math.min(args?.limit ?? 20, 100)
          const since = new Date(Date.now() - days * 86400_000)
          const orders = await this.prisma.paymentOrder.findMany({
            where: { payerId: subjectId, createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
              orderNo: true,
              amount: true,
              status: true,
              paidAt: true,
              createdAt: true,
            },
          })
          return {
            count: orders.length,
            orders: orders.map((o) => ({ ...o, amountYuan: fenToYuan(o.amount) })),
          }
        },
      },
      {
        name: 'kbpay_send_message',
        description: '向用户发送站内消息（如异常告警、推荐等）',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH'] },
          },
          required: ['title', 'content'],
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:notify')
          const subjectId = this.requireSubjectId(ctx)
          const title = this.truncate(args?.title, 100)
          const content = this.truncate(args?.content, 2000)
          if (!title || !content) {
            throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '标题和内容不能为空'))
          }
          return deps.messagesService.sendMessage({
            userId: subjectId,
            category: 'SYSTEM',
            title,
            content,
            channels: 'IN_APP',
            priority: args.priority ?? 'NORMAL',
          })
        },
      },
      {
        name: 'kbpay_claim_coupon',
        description: '为用户领取优惠券',
        inputSchema: {
          type: 'object',
          properties: {
            couponNo: { type: 'string', description: '优惠券编号（couponNo）' },
          },
          required: ['couponNo'],
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'wallet:write:coupon')
          const subjectId = this.requireSubjectId(ctx)
          const couponNo = this.truncate(args?.couponNo, 64)
          if (!couponNo) {
            throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER, '优惠券编号不能为空'))
          }
          return deps.couponsService.claim(subjectId, couponNo)
        },
      },
    ]
  }

  /** ========== B 端店长助理工具 ========== */
  private merchantTools(ctx: AgentCurrentUser, deps: ToolDeps): LlmTool[] {
    return [
      {
        name: 'kbpay_query_merchant_orders',
        description: '查询商户订单列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: '订单状态过滤' },
            limit: { type: 'number' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'merchant:read')
          const limit = Math.min(args?.limit ?? 20, 100)
          // requireSubjectId 强校验：subjectId 缺失时若直接传 undefined，
          // Prisma 会静默忽略 merchantId 过滤条件导致查询全站订单（跨租户越权）
          const merchantId = this.requireSubjectId(ctx)
          const where: any = { merchantId }
          if (args?.status) where.status = args.status
          const orders = await this.prisma.paymentOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
              orderNo: true, amount: true, status: true, createdAt: true,
            },
          })
          return { count: orders.length, orders }
        },
      },
      {
        name: 'kbpay_query_merchant_stats',
        description: '查询商户收单统计（成功订单笔数/金额/退款）',
        inputSchema: { type: 'object', properties: {} },
        requireConfirm: false,
        execute: async () => {
          this.checkScope(ctx, 'merchant:read')
          const merchantId = this.requireSubjectId(ctx)
          const merchant = await this.prisma.merchant.findUnique({
            where: { id: merchantId },
            select: { merchantName: true, status: true },
          })
          if (!merchant) return { message: '商户不存在' }
          const [paidAgg, refundAgg] = await Promise.all([
            this.prisma.paymentOrder.aggregate({
              where: { merchantId, status: 'PAID' },
              _count: { id: true },
              _sum: { amount: true, fee: true },
            }),
            this.prisma.paymentOrder.aggregate({
              where: { merchantId, refundAmount: { gt: 0 } },
              _sum: { refundAmount: true },
            }),
          ])
          return {
            merchantName: merchant.merchantName,
            status: merchant.status,
            paidCount: paidAgg._count.id || 0,
            paidAmountYuan: fenToYuan(paidAgg._sum.amount || 0),
            feeYuan: fenToYuan(paidAgg._sum.fee || 0),
            refundAmountYuan: fenToYuan(refundAgg._sum.refundAmount || 0),
          }
        },
      },
    ]
  }

  /** ========== A 端风控审计官工具 ========== */
  private riskTools(ctx: AgentCurrentUser, deps: ToolDeps): LlmTool[] {
    return [
      {
        name: 'kbpay_query_risk_events',
        description: '查询风险事件列表',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'PENDING/HANDLED' },
            level: { type: 'string', description: 'LOW/MEDIUM/HIGH' },
            limit: { type: 'number' },
          },
        },
        requireConfirm: false,
        execute: async (args: any) => {
          this.checkScope(ctx, 'risk:read')
          const limit = Math.min(args?.limit ?? 50, 200)
          // 租户隔离：只允许查询当前主体（subjectId）自己的风险事件；
          // 此前 where 仅按 status/level 过滤，任意风控 Agent 可读全站风险事件（跨租户越权）
          const subjectId = this.requireSubjectId(ctx)
          const where: any = { userId: subjectId }
          if (args?.status) where.handled = args.status === 'HANDLED'
          if (args?.level) where.level = args.level
          const events = await this.prisma.riskEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
          return { count: events.length, events }
        },
      },
      {
        name: 'kbpay_query_health',
        description: '查询系统与调度任务健康状态',
        inputSchema: { type: 'object', properties: {} },
        requireConfirm: false,
        execute: async () => {
          this.checkScope(ctx, 'risk:read')
          return deps.scheduleHealthService.getScheduleStatus()
        },
      },
    ]
  }
}

/**
 * Tool 执行所需的依赖（由 AgentModule 注入）
 *  - messagesService：发站内消息
 *  - couponsService：领取优惠券
 *  - scheduleHealthService：查调度健康
 *  （合规聚合模式：transfersService 已移除，用户间转账下线）
 */
export interface ToolDeps {
  messagesService: any
  couponsService: any
  scheduleHealthService: any
}
