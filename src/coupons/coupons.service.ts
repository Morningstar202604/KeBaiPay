import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import {
  CouponType,
  CouponStatus,
  UserCouponStatus,
  RealNameStatus,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import { generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {buildLockKey, REDIS_LOCK_TTL_SECONDS} from '../common/constants'
import { CreateCouponDto } from './dto/create-coupon.dto'

/**
 * 优惠券 / 折扣码服务
 *
 * 模型：
 *  - Coupon：商家创建的优惠券模板（FIXED 固定金额 / PERCENT 百分比折扣）
 *  - UserCoupon：用户领取的优惠券实例（AVAILABLE / USED / EXPIRED）
 *
 * 流程：
 *  1. 商家 createCoupon 创建优惠券
 *  2. 用户 claim 领取优惠券（受 perUserLimit / totalQuota 限制）
 *  3. 核销端点已下线：优惠券抵扣未接入任何支付流，见 controller 注释
 *  4. 过期优惠券由调度标记 EXPIRED
 */
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
  ) {}

  // ============== 优惠券模板管理（商家视角）==============

  /** 创建优惠券 */
  async createCoupon(ownerId: string, dto: CreateCouponDto) {
    const owner = await this.usersService.findById(ownerId)
    if (!owner) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (owner.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    // 校验面值
    if (dto.type === CouponType.FIXED && dto.value <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.COUPON_VALUE_INVALID))
    }
    if (dto.type === CouponType.PERCENT && (dto.value < 1 || dto.value > 99)) {
      throw new BadRequestException(kbError(KBErrorCodes.COUPON_VALUE_INVALID))
    }
    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) {
      throw new BadRequestException(kbError(KBErrorCodes.COUPON_EXPIRED, '过期时间必须晚于当前时间'))
    }

    const couponNo = generateOrderNo('CP')
    // FIXED 类型：value 是元，转分存储；PERCENT 类型：value 是 1-99 百分比
    const valueStore = dto.type === CouponType.FIXED ? yuanToFen(dto.value) : dto.value
    const minAmount = dto.minAmountYuan ? yuanToFen(dto.minAmountYuan) : 0

    return this.prisma.coupon.create({
      data: {
        couponNo,
        ownerId,
        name: dto.name,
        type: dto.type,
        value: valueStore,
        minAmount,
        totalQuota: dto.totalQuota ?? 0,
        perUserLimit: dto.perUserLimit ?? 1,
        status: CouponStatus.ACTIVE,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    })
  }

  /** 查询优惠券详情（任意登录用户可查；只回吐公开字段，不暴露 ownerId/issuedCount 等内部信息） */
  async findByCouponNo(couponNo: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { couponNo },
      select: {
        couponNo: true,
        name: true,
        type: true,
        value: true,
        minAmount: true,
        totalQuota: true,
        perUserLimit: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    })
    if (!coupon) throw new NotFoundException(kbError(KBErrorCodes.COUPON_NOT_FOUND))
    return coupon
  }

  /** 列出我的优惠券（商家视角） */
  async listCoupons(ownerId: string, query: { status?: string; page?: number; limit?: number }) {
    const where: Prisma.CouponWhereInput = { ownerId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.coupon.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 启用/禁用优惠券 */
  async setCouponStatus(ownerId: string, couponNo: string, status: 'ACTIVE' | 'DISABLED') {
    const coupon = await this.prisma.coupon.findUnique({ where: { couponNo } })
    if (!coupon) throw new NotFoundException(kbError(KBErrorCodes.COUPON_NOT_FOUND))
    if (coupon.ownerId !== ownerId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该优惠券'))
    }
    if (coupon.status === status) {
      throw new BadRequestException(kbError(KBErrorCodes.COUPON_STATUS_INVALID, '状态未变化'))
    }
    return this.prisma.coupon.update({
      where: { id: coupon.id },
      data: { status },
    })
  }

  // ============== 用户优惠券管理 ==============

  /** 用户领取优惠券 */
  async claim(userId: string, couponNo: string) {
    return this.redis.withLock(buildLockKey('coupon:claim', `${couponNo}:${userId}`),
      REDIS_LOCK_TTL_SECONDS,
      async () =>
        this.prisma.$transaction(async (tx) => {
          const coupon = await tx.coupon.findUnique({ where: { couponNo } })
          if (!coupon) throw new NotFoundException(kbError(KBErrorCodes.COUPON_NOT_FOUND))
          if (coupon.status !== CouponStatus.ACTIVE) {
            throw new BadRequestException(kbError(KBErrorCodes.COUPON_DISABLED))
          }
          if (coupon.expiresAt && coupon.expiresAt <= new Date()) {
            throw new BadRequestException(kbError(KBErrorCodes.COUPON_EXPIRED))
          }
          // 总量校验
          if (coupon.totalQuota > 0 && coupon.issuedCount >= coupon.totalQuota) {
            throw new BadRequestException(kbError(KBErrorCodes.COUPON_QUOTA_EXHAUSTED))
          }
          // 单用户领取上限校验
          const userClaimedCount = await tx.userCoupon.count({
            where: { couponId: coupon.id, userId },
          })
          if (userClaimedCount >= coupon.perUserLimit) {
            throw new BadRequestException(kbError(KBErrorCodes.COUPON_ALREADY_CLAIMED))
          }

          const userCouponNo = generateOrderNo('UC')
          const userCoupon = await tx.userCoupon.create({
            data: {
              userCouponNo,
              couponId: coupon.id,
              userId,
              status: UserCouponStatus.AVAILABLE,
            },
          })

          // 条件更新抢占发放名额：不同用户并发领取的锁互不互斥，
          // 普通读检查 + 无条件 increment 在高并发下会超发。
          // 仅当 issuedCount < totalQuota 时才递增，抢不到即回滚整个领取事务。
          if (coupon.totalQuota > 0) {
            const quotaResult = await tx.coupon.updateMany({
              where: { id: coupon.id, issuedCount: { lt: coupon.totalQuota } },
              data: { issuedCount: { increment: 1 } },
            })
            if (quotaResult.count === 0) {
              throw new BadRequestException(kbError(KBErrorCodes.COUPON_QUOTA_EXHAUSTED))
            }
          }

          return userCoupon
        }),
    )
  }

  /** 列出我领取的优惠券 */
  async listMyCoupons(userId: string, query: { status?: string; page?: number; limit?: number }) {
    const where: Prisma.UserCouponWhereInput = { userId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.userCoupon.findMany({
        where,
        include: { coupon: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.userCoupon.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /**
   * 使用用户优惠券
   * @returns 折扣金额（分）
   */
  /** 查询用户优惠券详情 */
  async findUserCoupon(userId: string, userCouponNo: string) {
    const uc = await this.prisma.userCoupon.findUnique({
      where: { userCouponNo },
      include: { coupon: true },
    })
    if (!uc) throw new NotFoundException(kbError(KBErrorCodes.USER_COUPON_NOT_FOUND))
    if (uc.userId !== userId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查看该优惠券'))
    }
    return uc
  }

  // ============== 调度：自动标记过期 ==============

  /** 自动将过期的可用优惠券标记为 EXPIRED */
  async autoExpire() {
    const now = new Date()
    const result = await this.prisma.userCoupon.updateMany({
      where: {
        status: UserCouponStatus.AVAILABLE,
        coupon: { expiresAt: { lt: now } },
      },
      data: { status: UserCouponStatus.EXPIRED },
    })
    if (result.count > 0) {
      this.logger.log(`优惠券过期扫描：标记 ${result.count} 张过期`)
    }
    return result.count
  }
}
