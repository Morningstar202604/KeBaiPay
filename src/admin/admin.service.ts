import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import {
  UserStatus,
  RiskLevel,
  RiskEventType,
  MerchantStatus,
  PaymentOrderStatus,
  RealNameStatus,
  AdminRole,
  AdminStatus,
} from '../common/enums'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../crypto/crypto.service'
import { AuditLogService } from '../audit/audit-log.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { UpdateRiskRuleDto } from './dto/update-risk-rule.dto'
import { fenToYuan, yuanToFen, generateOrderNo } from '../common/helpers'
import { kbError, KBErrorCodes } from '../common/error-codes'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, BCRYPT_SALT_ROUNDS } from '../common/constants'

/**
 * 审计日志附加元信息
 *
 * 由 controller 从 Request 中提取后透传给 service，
 * 用于在审计日志中记录操作来源（IP / UA）。
 */
export interface AuditMeta {
  ip?: string
  userAgent?: string
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly auditLog: AuditLogService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  async getDashboardStats() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // 合规聚合模式：今日订单口径为收单订单（PaymentOrder），提现/资金池指标已下线
    const [
      totalUsers,
      totalMerchants,
      todayOrders,
      pendingMerchants,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.merchant.count(),
      this.prisma.paymentOrder.count({
        where: { createdAt: { gte: today } },
      }),
      this.prisma.merchant.count({
        where: { status: MerchantStatus.PENDING },
      }),
    ])

    return {
      totalUsers,
      totalMerchants,
      todayOrders,
      pendingMerchants,
    }
  }

  async listUsers(query: {
    keyword?: string
    status?: UserStatus
    page?: number
    limit?: number
  }) {
    const where: Prisma.UserWhereInput = {}
    if (query.status) {
      where.status = query.status
    }
    if (query.keyword) {
      const keyword = query.keyword
      where.OR = [
        { phone: { contains: keyword } },
        { email: { contains: keyword } },
        { nickname: { contains: keyword } },
      ]
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ])

    return {
      data: data.map((u) => {
        // 密码哈希不外发：list/detail 均为 admin:view 可达，最小化数据面
        const { loginPassword: _lp, payPassword: _pp, ...safe } = u
        return {
          ...safe,
          phone: safe.phone
            ? safe.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
            : null,
          email: safe.email
            ? safe.email.replace(/(.{2}).*(@.*)/, '$1***$2')
            : null,
        }
      }),
      total,
      page,
      limit,
    }
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        identity: true,
        merchant: true,
        loginLogs: {
          orderBy: { createdAt: 'desc' },
          take: DEFAULT_PAGE_SIZE,
        },
        riskEvents: {
          orderBy: { createdAt: 'desc' },
          take: DEFAULT_PAGE_SIZE,
        },
      },
    })
    if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    const { loginPassword: _lp, payPassword: _pp, ...safeUser } = user
    return {
      ...safeUser,
      identity: safeUser.identity
        ? {
            // 暂存支付密码哈希与证件哈希列不外发（哈希可被离线穷举）
            ...safeUser.identity,
            pendingPayPasswordHash: undefined,
            idCardHash: undefined,
            idCard: this.maskIdCard(this.decryptIdCard(safeUser.identity.idCard)),
          }
        : null,
    }
  }

  private decryptIdCard(encryptedIdCard: string): string {
    try {
      return this.crypto.decrypt(encryptedIdCard)
    } catch {
      // 兼容未加密的旧数据
      return encryptedIdCard
    }
  }

  private maskIdCard(idCard: string): string {
    return this.crypto.mask(idCard, 4, 4)
  }

  async updateUserStatus(
    userId: string,
    status: UserStatus,
    reason?: string,
    adminId?: string,
    auditMeta?: AuditMeta,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { status },
      })

      await tx.riskEvent.create({
        data: {
          userId,
          type: RiskEventType.STATUS_CHANGED,
          level: RiskLevel.MEDIUM,
          description: `管理员修改用户状态为 ${status}${reason ? '，原因：' + reason : ''}`,
          handledBy: adminId,
          handledAt: new Date(),
          handled: true,
        },
      })

      // 敏感操作写入防篡改审计日志
      await this.auditLog.log(
        {
          adminId: adminId ?? 'system',
          action: 'USER_STATUS_UPDATE',
          target: userId,
          detail: { status, reason },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      return updated
    })
  }

  async updateUserRiskLevel(
    userId: string,
    level: RiskLevel,
    adminId?: string,
    auditMeta?: AuditMeta,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { riskLevel: level },
      })

      // 敏感操作写入防篡改审计日志
      await this.auditLog.log(
        {
          adminId: adminId ?? 'system',
          action: 'USER_RISK_LEVEL_UPDATE',
          target: userId,
          detail: { level },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      return updated
    })
  }

  async listMerchants(query: {
    status?: MerchantStatus
    page?: number
    limit?: number
  }) {
    const where: Prisma.MerchantWhereInput = {}
    if (query.status) {
      where.status = query.status
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))

    const [data, total] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { nickname: true, phone: true, email: true } },
        },
      }),
      this.prisma.merchant.count({ where }),
    ])

    return {
      data: data.map((m) => ({
        ...m,
        contactPhone: m.contactPhone
          ? m.contactPhone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
          : null,
        dailyLimitYuan: fenToYuan(m.dailyLimit),
      })),
      total,
      page,
      limit,
    }
  }

  async listPaymentOrders(query: {
    status?: PaymentOrderStatus
    page?: number
    limit?: number
  }) {
    const where: Prisma.PaymentOrderWhereInput = {}
    if (query.status) {
      where.status = query.status
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))

    const [data, total] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          merchant: { select: { merchantNo: true, merchantName: true } },
        },
      }),
      this.prisma.paymentOrder.count({ where }),
    ])

    return {
      data: data.map((o) => ({
        ...o,
        amountYuan: fenToYuan(o.amount),
        feeYuan: fenToYuan(o.fee),
      })),
      total,
      page,
      limit,
    }
  }

  async listRiskEvents(query: {
    level?: RiskLevel
    handled?: boolean
    page?: number
    limit?: number
  }) {
    const where: Prisma.RiskEventWhereInput = {}
    if (query.level) {
      where.level = query.level
    }
    if (typeof query.handled === 'boolean') {
      where.handled = query.handled
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))

    const [data, total] = await Promise.all([
      this.prisma.riskEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { nickname: true, phone: true, email: true } },
        },
      }),
      this.prisma.riskEvent.count({ where }),
    ])

    return { data, total, page, limit }
  }

  async handleRiskEvent(
    id: string,
    handledBy: string,
    auditMeta?: AuditMeta,
    note?: string,
  ) {
    const event = await this.prisma.riskEvent.findUnique({ where: { id } })
    if (!event) throw new NotFoundException(kbError(KBErrorCodes.RISK_EVENT_NOT_FOUND))

    // 业务写与审计日志在同一事务，保证审计与状态变更一致
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.riskEvent.update({
        where: { id },
        data: {
          handled: true,
          handledBy,
          handledAt: new Date(),
          ...(note ? { description: `${event.description}\n[处置说明] ${note}` } : {}),
        },
      })

      // 风险事件处理属于敏感操作，写入防篡改审计日志
      await this.auditLog.log(
        {
          adminId: handledBy,
          action: 'RISK_EVENT_HANDLE',
          target: id,
          detail: {
            userId: event.userId,
            type: event.type,
            level: event.level,
            ...(note ? { note } : {}),
          },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      return updated
    })
  }

  async listLoginLogs(query: {
    userId?: string
    page?: number
    limit?: number
  }) {
    const where: Prisma.LoginLogWhereInput = {}
    if (query.userId) {
      where.userId = query.userId
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))

    const [data, total] = await Promise.all([
      this.prisma.loginLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { nickname: true, phone: true, email: true } },
        },
      }),
      this.prisma.loginLog.count({ where }),
    ])

    return { data, total, page, limit }
  }

  async getSystemConfigs() {
    return this.prisma.systemConfig.findMany({ orderBy: { key: 'asc' } })
  }

  async setSystemConfig(
    key: string,
    value: string,
    adminId?: string,
    auditMeta?: AuditMeta,
  ) {
    // 修改前先获取旧值，用于审计日志记录变更前后
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key },
    })
    const oldValue = existing?.value ?? null

    // upsert 语义：不存在则创建，存在则更新
    const updated = await this.persistConfigWithAudit(
      key,
      value,
      oldValue,
      'SYSTEM_CONFIG_SET',
      adminId,
      auditMeta,
      'upsert',
    )

    // 风控规则变更后清空规则缓存，使新配置立即生效
    if (key.startsWith('risk_rule:')) {
      this.riskEngine.clearCache()
    }

    return updated
  }

  /**
   * 系统配置写入 + 审计日志的共享事务模板。
   *
   * 三个公共方法（setSystemConfig / createSystemConfig / updateSystemConfig）
   * 各自完成语义校验后委托给本方法，避免事务模板与缓存清理逻辑重复。
   *
   * @param mode 'upsert' | 'create' | 'update' 决定调用 prisma 的哪个写方法
   */
  private async persistConfigWithAudit(
    key: string,
    value: string,
    oldValue: string | null,
    action: string,
    adminId: string | undefined,
    auditMeta: AuditMeta | undefined,
    mode: 'upsert' | 'create' | 'update',
  ) {
    // 业务写与审计日志在同一事务，保证配置变更可追溯
    const result = await this.prisma.$transaction(async (tx) => {
      let config: { key: string; value: string }
      if (mode === 'upsert') {
        config = await tx.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        })
      } else if (mode === 'create') {
        config = await tx.systemConfig.create({ data: { key, value } })
      } else {
        config = await tx.systemConfig.update({ where: { key }, data: { value } })
      }

      // 系统配置变更属于敏感操作，写入防篡改审计日志
      // create 模式 detail 只含新值（无 old），upsert/update 模式含 old+new
      const detail =
        mode === 'create' ? { value } : { old: oldValue, new: value }

      await this.auditLog.log(
        {
          adminId: adminId ?? 'system',
          action,
          target: key,
          detail,
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      return config
    })

    // 风控规则变更后清空规则缓存（事务外执行，避免 DB 事务持锁过久）
    if (key.startsWith('risk_rule:')) {
      this.riskEngine.clearCache()
    }

    return result
  }

  /**
   * 获取风控规则列表（默认规则与 SystemConfig 自定义规则合并，含已禁用）
   */
  async getRiskRules() {
    return this.riskEngine.listAllRules()
  }

  /**
   * 更新风控规则配置，序列化为 JSON 存入 SystemConfig（key=risk_rule:{code}）。
   * setSystemConfig 会在 key 以 risk_rule: 开头时自动清空风控规则缓存。
   */
  async updateRiskRule(
    code: string,
    dto: UpdateRiskRuleDto,
    adminId?: string,
    auditMeta?: AuditMeta,
  ) {
    const key = `risk_rule:${code}`
    const value = JSON.stringify(dto)
    return this.setSystemConfig(key, value, adminId, auditMeta)
  }

  async logAction(
    adminId: string,
    action: string,
    target: string | null,
    detail: unknown,
    auditMeta?: AuditMeta,
  ) {
    // 通过审计日志服务写入，带哈希链防篡改
    await this.auditLog.log({ adminId, action, target, detail, ...auditMeta })
  }

  async listAuditLogs(query: {
    adminId?: string
    action?: string
    startDate?: string
    endDate?: string
    page?: number
    limit?: number
  }) {
    const where: Prisma.AdminOperationLogWhereInput = {}
    if (query.adminId) {
      where.adminId = query.adminId
    }
    if (query.action) {
      where.action = query.action
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {}
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00.000Z`)
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`)
      }
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE),
    )

    const [data, total] = await Promise.all([
      this.prisma.adminOperationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminOperationLog.count({ where }),
    ])

    return { data, total, page, limit }
  }

  async listPendingIdentities(query: { page?: number; limit?: number }) {
    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(50, query.limit || 50))

    const [data, total] = await Promise.all([
      this.prisma.identityVerification.findMany({
        where: { status: RealNameStatus.PENDING },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: { id: true, nickname: true, phone: true, email: true },
          },
        },
      }),
      this.prisma.identityVerification.count({
        where: { status: RealNameStatus.PENDING },
      }),
    ])

    return { data, total, page, limit }
  }

  async approveIdentity(id: string, adminId: string, auditMeta?: AuditMeta) {
    const identity = await this.prisma.identityVerification.findUnique({
      where: { id },
    })
    if (!identity) throw new NotFoundException(kbError(KBErrorCodes.IDENTITY_RECORD_NOT_FOUND))
    if (identity.status !== RealNameStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.IDENTITY_NOT_PENDING))
    }

    return this.prisma.$transaction(async (tx) => {
      // H3: 使用 updateMany + status:PENDING 原子守卫，防止 findUnique 检查与更新之间状态被并发改变（TOCTOU）
      const lockResult = await tx.identityVerification.updateMany({
        where: { id, status: RealNameStatus.PENDING },
        data: { status: RealNameStatus.VERIFIED },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.IDENTITY_NOT_PENDING))
      }

      // 审核通过：把暂存的支付密码哈希写入 user.payPassword，用户自此可使用支付密码
      // 若 identityVerification.pendingPayPasswordHash 为 null（历史数据兼容），不覆盖已有 payPassword
      if (identity.pendingPayPasswordHash) {
        await tx.user.update({
          where: { id: identity.userId },
          data: {
            realNameStatus: RealNameStatus.VERIFIED,
            payPassword: identity.pendingPayPasswordHash,
          },
        })
      } else {
        await tx.user.update({
          where: { id: identity.userId },
          data: { realNameStatus: RealNameStatus.VERIFIED },
        })
      }

      // 敏感操作写入防篡改审计日志
      await this.auditLog.log(
        {
          adminId,
          action: 'IDENTITY_AUDIT',
          target: id,
          detail: { action: 'APPROVE', userId: identity.userId },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      // updateMany 不返回更新后的记录，用原记录 + 新状态构造返回值
      return { ...identity, status: RealNameStatus.VERIFIED }
    })
  }

  async rejectIdentity(
    id: string,
    reason: string,
    adminId: string,
    auditMeta?: AuditMeta,
  ) {
    const identity = await this.prisma.identityVerification.findUnique({
      where: { id },
    })
    if (!identity) throw new NotFoundException(kbError(KBErrorCodes.IDENTITY_RECORD_NOT_FOUND))
    if (identity.status !== RealNameStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.IDENTITY_NOT_PENDING))
    }

    return this.prisma.$transaction(async (tx) => {
      // H3: 使用 updateMany + status:PENDING 原子守卫，防止 findUnique 检查与更新之间状态被并发改变（TOCTOU）
      // 同时清空 pendingPayPasswordHash：拒绝后不应保留未生效的密码哈希
      const lockResult = await tx.identityVerification.updateMany({
        where: { id, status: RealNameStatus.PENDING },
        data: {
          status: RealNameStatus.REJECTED,
          pendingPayPasswordHash: null,
        },
      })
      if (lockResult.count === 0) {
        throw new BadRequestException(kbError(KBErrorCodes.IDENTITY_NOT_PENDING))
      }

      await tx.user.update({
        where: { id: identity.userId },
        data: { realNameStatus: RealNameStatus.REJECTED },
      })

      // 敏感操作写入防篡改审计日志
      await this.auditLog.log(
        {
          adminId,
          action: 'IDENTITY_AUDIT',
          target: id,
          detail: { action: 'REJECT', userId: identity.userId, reason },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      // updateMany 不返回更新后的记录，用原记录 + 新状态构造返回值
      return { ...identity, status: RealNameStatus.REJECTED }
    })
  }

  async getAdminUsers(query: {
    keyword?: string
    role?: AdminRole
    status?: AdminStatus
    page?: number
    limit?: number
  }) {
    const where: Prisma.AdminUserWhereInput = {}
    if (query.role) {
      where.role = query.role
    }
    if (query.status) {
      where.status = query.status
    }
    if (query.keyword) {
      where.OR = [
        { username: { contains: query.keyword } },
      ]
    }

    const page = Math.max(1, query.page || 1)
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE))

    const [data, total] = await Promise.all([
      this.prisma.adminUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          nickname: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.adminUser.count({ where }),
    ])

    return { data, total, page, limit }
  }

  async createAdminUser(
    data: {
      username: string
      password: string
      role: AdminRole
      nickname?: string
    },
    currentAdminId?: string,
  ) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { username: data.username },
    })
    if (existing) {
      throw new ConflictException(kbError(KBErrorCodes.ADMIN_USERNAME_EXISTS))
    }

    // bcrypt.hash 在事务外执行：CPU 密集型操作不应在 DB 事务内拉长持锁时间
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS)

    // 创建管理员属高危操作，业务写与审计日志在同一事务
    const admin = await this.prisma.$transaction(async (tx) => {
      const created = await tx.adminUser.create({
        data: {
          username: data.username,
          password: hashedPassword,
          role: data.role,
          nickname: data.nickname,
        },
        select: {
          id: true,
          username: true,
          nickname: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      await this.auditLog.log(
        {
          adminId: currentAdminId ?? 'system',
          action: 'ADMIN_USER_CREATE',
          target: created.id,
          detail: { username: created.username, role: created.role },
        },
        tx,
      )

      return created
    })

    return admin
  }

  async updateAdminUser(
    id: string,
    data: { nickname?: string; role?: AdminRole; status?: AdminStatus },
    currentAdminId: string,
    auditMeta?: AuditMeta,
  ) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id } })
    if (!admin) {
      throw new NotFoundException(kbError(KBErrorCodes.ADMIN_USER_NOT_FOUND))
    }

    // 角色变更仅限 SUPER_ADMIN 操作者：此前误校验"被编辑目标"的角色，
    // 导致低权操作者可把任意管理员提权为 SUPER_ADMIN
    if (data.role !== undefined) {
      const actor = await this.prisma.adminUser.findUnique({
        where: { id: currentAdminId },
        select: { role: true },
      })
      if (actor?.role !== AdminRole.SUPER_ADMIN) {
        throw new ForbiddenException(
          kbError(KBErrorCodes.ADMIN_INSUFFICIENT_PERMISSIONS, '仅超级管理员可以变更管理员角色'),
        )
      }
    }

    // 不能将自己的状态设为 DISABLED
    if (id === currentAdminId && data.status === AdminStatus.DISABLED) {
      throw new BadRequestException(kbError(KBErrorCodes.ADMIN_CANNOT_DELETE_SELF))
    }

    // 最后超级管理员保护：降级或禁用 SUPER_ADMIN 前确认还存在其他可用超管，
    // 否则后台可能永久失去超级管理员（此前可自我降级/禁用导致无超管可救）
    if (
      admin.role === AdminRole.SUPER_ADMIN &&
      ((data.role !== undefined && data.role !== AdminRole.SUPER_ADMIN) ||
        (data.status === AdminStatus.DISABLED))
    ) {
      await this.assertNotLastActiveSuperAdmin(id)
    }

    // 业务写与审计日志在同一事务，保证权限变更可追溯
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.adminUser.update({
        where: { id },
        data: {
          ...(data.nickname !== undefined && { nickname: data.nickname }),
          ...(data.role !== undefined && { role: data.role }),
          ...(data.status !== undefined && { status: data.status }),
        },
        select: {
          id: true,
          username: true,
          nickname: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      await this.auditLog.log(
        {
          adminId: currentAdminId,
          action: 'ADMIN_USER_UPDATE',
          target: id,
          detail: { changes: data },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      return updated
    })
  }

  async deleteAdminUser(
    id: string,
    currentAdminId: string,
    auditMeta?: AuditMeta,
  ) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id } })
    if (!admin) {
      throw new NotFoundException(kbError(KBErrorCodes.ADMIN_USER_NOT_FOUND))
    }

    if (id === currentAdminId) {
      throw new BadRequestException(kbError(KBErrorCodes.ADMIN_CANNOT_DELETE_SELF))
    }

    // 最后超级管理员保护：软删除（禁用）SUPER_ADMIN 前确认还有其他可用超管
    if (admin.role === AdminRole.SUPER_ADMIN) {
      await this.assertNotLastActiveSuperAdmin(id)
    }

    // 业务写与审计日志在同一事务，保证管理员禁用可追溯
    return this.prisma.$transaction(async (tx) => {
      // 软删除：将状态设为 DISABLED
      const updated = await tx.adminUser.update({
        where: { id },
        data: { status: AdminStatus.DISABLED },
        select: {
          id: true,
          username: true,
          nickname: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      await this.auditLog.log(
        {
          adminId: currentAdminId,
          action: 'ADMIN_USER_DELETE',
          target: id,
          detail: { username: admin.username },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )

      return updated
    })
  }

  async resetAdminPassword(
    id: string,
    newPassword: string,
    currentAdminId: string,
    auditMeta?: AuditMeta,
  ) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id } })
    if (!admin) {
      throw new NotFoundException(kbError(KBErrorCodes.ADMIN_USER_NOT_FOUND))
    }

    // bcrypt.hash 在事务外执行：CPU 密集型操作不应在 DB 事务内拉长持锁时间
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS)

    // 业务写与审计日志在同一事务，保证密码重置可追溯；tokenVersion 自增使已签发旧 JWT 全部失效
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id },
        data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      })

      await this.auditLog.log(
        {
          adminId: currentAdminId,
          action: 'ADMIN_PASSWORD_RESET',
          target: id,
          detail: { username: admin.username },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )
    })

    return { message: '密码重置成功' }
  }

  async changeAdminPassword(
    adminId: string,
    oldPassword: string,
    newPassword: string,
    auditMeta?: AuditMeta,
  ) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } })
    if (!admin) {
      throw new NotFoundException(kbError(KBErrorCodes.ADMIN_USER_NOT_FOUND))
    }

    const isOldPasswordValid = await bcrypt.compare(oldPassword, admin.password)
    if (!isOldPasswordValid) {
      throw new BadRequestException(kbError(KBErrorCodes.ADMIN_OLD_PASSWORD_INCORRECT))
    }

    // bcrypt.hash 在事务外执行：CPU 密集型操作不应在 DB 事务内拉长持锁时间
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS)

    // 业务写与审计日志在同一事务，保证密码变更可追溯；tokenVersion 自增使该管理员旧 JWT 全部失效
    await this.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({
        where: { id: adminId },
        data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      })

      await this.auditLog.log(
        {
          adminId,
          action: 'ADMIN_PASSWORD_CHANGE',
          target: adminId,
          detail: { username: admin.username },
          ip: auditMeta?.ip,
          userAgent: auditMeta?.userAgent,
        },
        tx,
      )
    })

    return { message: '密码修改成功，请重新登录' }
  }

  // ==================== System Config ====================

  async getSystemConfigByKey(key: string) {
    const config = await this.prisma.systemConfig.findUnique({ where: { key } })
    if (!config) {
      throw new NotFoundException(kbError(KBErrorCodes.ADMIN_CONFIG_KEY_NOT_FOUND))
    }
    return config
  }

  async createSystemConfig(key: string, value: string, adminId?: string, auditMeta?: AuditMeta) {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } })
    if (existing) {
      throw new ConflictException(kbError(KBErrorCodes.ADMIN_CONFIG_KEY_EXISTS))
    }

    // 委托给共享事务模板（mode='create'，审计 detail 只含新值）
    return this.persistConfigWithAudit(
      key,
      value,
      null,
      'SYSTEM_CONFIG_CREATE',
      adminId,
      auditMeta,
      'create',
    )
  }

  async updateSystemConfig(key: string, value: string, adminId?: string, auditMeta?: AuditMeta) {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } })
    if (!existing) {
      throw new NotFoundException(kbError(KBErrorCodes.ADMIN_CONFIG_KEY_NOT_FOUND))
    }

    // 委托给共享事务模板（mode='update'，审计 detail 含 old+new）
    return this.persistConfigWithAudit(
      key,
      value,
      existing.value,
      'SYSTEM_CONFIG_UPDATE',
      adminId,
      auditMeta,
      'update',
    )
  }

  /** 最后超级管理员保护：目标 SUPER_ADMIN 之外若已无其他 ACTIVE 超管则拒绝 */
  private async assertNotLastActiveSuperAdmin(excludeId: string): Promise<void> {
    const others = await this.prisma.adminUser.count({
      where: {
        id: { not: excludeId },
        role: AdminRole.SUPER_ADMIN,
        status: AdminStatus.ACTIVE,
      },
    })
    if (others === 0) {
      throw new BadRequestException(
        kbError(KBErrorCodes.ADMIN_CANNOT_DELETE_SELF, '不能删除或降级最后一个超级管理员'),
      )
    }
  }
}
