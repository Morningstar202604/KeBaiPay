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
  ReferralStatus,
  RealNameStatus,
  UserStatus,
  AccountStatus,
  TransactionType,
  TransactionStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RedisService } from '../redis/redis.service'
import { generateOrderNo } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import {
  buildLockKey,
  REDIS_LOCK_TTL_SECONDS,
  DEFAULT_REFERRAL_REWARD_CENTS,
  MAX_REFERRAL_REWARD_CENTS,
  REFERRAL_CODE_LENGTH,
  REFERRAL_TRIGGER_MIN_AMOUNT_CENTS,
  MAX_REFERRALS_PER_USER,
} from '../common/constants'
import { BindReferralDto, ListReferralDto, CancelReferralDto, TriggerRewardDto } from './dto/referral.dto'
import { randomBytes } from 'crypto'

/**
 * 邀请返现 / 推荐奖励服务
 *
 * 资金流：
 *  1. 用户 getOrCreateMyCode 生成专属邀请码（一人一码）
 *  2. 新用户注册后调用 bindInvitee 绑定邀请关系（Referral.status=PENDING）
 *  3. 当被邀请人完成首笔满足条件的交易（充值/支付）时，
 *     triggerReward 发放奖励给邀请人：
 *     - 平台账户（系统） → 邀请人账户
 *     - 记录账本、账单、TransactionOrder
 *     - Referral.status=COMPLETED
 *  4. cancel 取消邀请关系（管理员或邀请人，仅 PENDING 状态）
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name)

  // 易混字符 0/O/I/1/L 排除
  private static readonly CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
  ) {}

  /** 获取或创建我的邀请码 */
  async getOrCreateMyCode(userId: string) {
    const existing = await this.prisma.referralCode.findUnique({
      where: { userId },
    })
    if (existing) return existing

    return this.redis.withLock(buildLockKey('referral:code:create', userId),
      REDIS_LOCK_TTL_SECONDS,
      async () => {
        // 双重检查
        const again = await this.prisma.referralCode.findUnique({
          where: { userId },
        })
        if (again) return again

        const code = await this.generateUniqueCode()
        return this.prisma.referralCode.create({
          data: {
            code,
            userId,
          },
        })
      },
    )
  }

  /** 通过邀请码查询邀请人 */
  async findCodeByCode(code: string) {
    return this.prisma.referralCode.findUnique({
      where: { code: code.toUpperCase() },
    })
  }

  /** 查询我的邀请码（不存在返回 null） */
  async findMyCode(userId: string) {
    return this.prisma.referralCode.findUnique({ where: { userId } })
  }

  /**
   * 绑定邀请关系（被邀请人调用）
   * - 校验邀请码存在、不是自己、未绑定过
   */
  async bindInvitee(inviteeId: string, dto: BindReferralDto) {
    const code = dto.code.toUpperCase()
    const referrerCode = await this.prisma.referralCode.findUnique({
      where: { code },
    })
    if (!referrerCode) {
      throw new NotFoundException(kbError(KBErrorCodes.REFERRAL_CODE_NOT_FOUND))
    }
    if (referrerCode.userId === inviteeId) {
      throw new BadRequestException(kbError(KBErrorCodes.REFERRAL_CANNOT_SELF))
    }

    // 邀请人单日邀请上限
    if (MAX_REFERRALS_PER_USER > 0) {
      const count = await this.prisma.referral.count({
        where: { referrerId: referrerCode.userId },
      })
      if (count >= MAX_REFERRALS_PER_USER) {
        throw new BadRequestException(kbError(KBErrorCodes.FORBIDDEN, '邀请人邀请数量已达上限'))
      }
    }

    return this.redis.withLock(buildLockKey('referral:bind', inviteeId),
      REDIS_LOCK_TTL_SECONDS,
      async () =>
        this.prisma.$transaction(async (tx) => {
          // 检查被邀请人是否已绑定
          const existing = await tx.referral.findUnique({
            where: { inviteeId },
          })
          if (existing) {
            throw new BadRequestException(kbError(KBErrorCodes.REFERRAL_ALREADY_BOUND))
          }

          const referralNo = generateOrderNo('REF')
          return tx.referral.create({
            data: {
              referralNo,
              referrerId: referrerCode.userId,
              inviteeId,
              status: ReferralStatus.PENDING,
              rewardAmount: 0,
            },
          })
        }),
    )
  }

  /** 列出我邀请的人 */
  async listMyReferrals(referrerId: string, query: ListReferralDto) {
    const where: Prisma.ReferralWhereInput = { referrerId }
    if (query.status) where.status = query.status
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))
    const [items, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referral.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 邀请统计 */
  async getStats(referrerId: string) {
    const [total, pending, completed, cancelled, totalRewardAgg] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId } }),
      this.prisma.referral.count({
        where: { referrerId, status: ReferralStatus.PENDING },
      }),
      this.prisma.referral.count({
        where: { referrerId, status: ReferralStatus.COMPLETED },
      }),
      this.prisma.referral.count({
        where: { referrerId, status: ReferralStatus.CANCELLED },
      }),
      this.prisma.referral.aggregate({
        where: { referrerId, status: ReferralStatus.COMPLETED },
        _sum: { rewardAmount: true },
      }),
    ])
    return {
      total,
      pending,
      completed,
      cancelled,
      totalRewardAmount: totalRewardAgg._sum.rewardAmount || 0,
    }
  }

  /** 查询邀请关系详情（仅邀请人或被邀请人可查看） */
  async findByReferralNo(referralNo: string, viewerId?: string) {
    const referral = await this.prisma.referral.findUnique({
      where: { referralNo },
    })
    if (!referral) {
      throw new NotFoundException(kbError(KBErrorCodes.REFERRAL_NOT_FOUND))
    }
    // 归属校验：防止任意登录用户遍历查询他人邀请关系（此前为 IDOR）
    if (viewerId && referral.referrerId !== viewerId && referral.inviteeId !== viewerId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权查看该邀请关系'))
    }
    return referral
  }

  /**
   * 触发奖励发放（内部调用）
   * @param inviteeId 被邀请人 ID
   * @param txNo 触发交易订单号
   * @param txAmountFen 交易金额（分），不传则从订单查询
   */
  async triggerReward(inviteeId: string, dto: TriggerRewardDto) {
    return this.redis.withLock(buildLockKey('referral:reward', inviteeId),
      REDIS_LOCK_TTL_SECONDS,
      async () =>
        this.prisma.$transaction(async (tx) => {
          const referral = await tx.referral.findUnique({
            where: { inviteeId },
          })
          if (!referral) {
            throw new NotFoundException(kbError(KBErrorCodes.REFERRAL_NOT_FOUND))
          }
          if (referral.status !== ReferralStatus.PENDING) {
            throw new BadRequestException(kbError(KBErrorCodes.REFERRAL_NOT_PENDING))
          }

          // 查询触发交易
          const order = await tx.transactionOrder.findFirst({
            where: {
              OR: [{ orderNo: dto.transactionNo }, { id: dto.transactionNo }],
            },
          })
          if (!order) {
            throw new BadRequestException(kbError(KBErrorCodes.REFERRAL_TRIGGER_INVALID, '触发交易不存在'))
          }
          if (order.status !== TransactionStatus.SUCCESS) {
            throw new BadRequestException(
              kbError(KBErrorCodes.REFERRAL_TRIGGER_INVALID, '触发交易未成功'),
            )
          }
          // 仅允许 RECHARGE（外部渠道充值）触发奖励：
          // PAYMENT / TRANSFER / RED_PACKET 均为平台内部资金流转，资金从未离开平台，
          // 邀请人可通过给自己小号转账/发红包零成本刷取平台奖励（此前为 P1 漏洞）。
          // 充值订单 fromUserId 恒为 null（外部渠道入账），无需再校验对端归属。
          if ((order.type as TransactionType) !== TransactionType.RECHARGE) {
            throw new BadRequestException(
              kbError(
                KBErrorCodes.REFERRAL_TRIGGER_INVALID,
                '仅外部渠道充值可触发邀请奖励',
              ),
            )
          }
          // 被邀请人必须是充值入账方
          if (order.toUserId !== inviteeId) {
            throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权触发该邀请奖励'))
          }
          // 防递归套娃：奖励单自身 type=RECHARGE、toUserId=邀请人（referrerId），
          // 若邀请人也作为他人被邀请人，可用自己的奖励单沿邀请链逐层再触发奖励
          // （上一轮"仅 RECHARGE"修复的绕过）。奖励单恒带 relatedOrderNo（指向邀请单），
          // 而外部渠道充值单创建时不写 relatedOrderNo，此处以该字段隔离奖励单：
          // 奖励单不再具备触发资格，套娃链在下一层即被截断。
          if (order.relatedOrderNo) {
            throw new BadRequestException(
              kbError(
                KBErrorCodes.REFERRAL_TRIGGER_INVALID,
                '奖励单不能作为邀请奖励触发交易',
              ),
            )
          }

          // 交易金额一律以订单实际金额为准：dto.amount 可由客户端自报，
          // 此前可传任意大金额绕过 REFERRAL_TRIGGER_MIN_AMOUNT_CENTS 门槛
          const txAmount = order.amount
          if (txAmount < REFERRAL_TRIGGER_MIN_AMOUNT_CENTS) {
            throw new BadRequestException(
              kbError(KBErrorCodes.REFERRAL_TRIGGER_INVALID, '交易金额不满足奖励触发门槛'),
            )
          }

          // 读取奖励配置（system_config）
          const rewardConfig = await tx.systemConfig.findUnique({
            where: { key: 'referral_reward_amount' },
          })
          let rewardAmount = DEFAULT_REFERRAL_REWARD_CENTS
          if (rewardConfig) {
            const parsed = Math.round(Number(rewardConfig.value) * 100)
            if (Number.isFinite(parsed) && parsed > 0) {
              rewardAmount = Math.min(parsed, MAX_REFERRAL_REWARD_CENTS)
            }
          }

          // 邀请人账户校验
          const referrerAccount = await tx.account.findUnique({
            where: { userId: referral.referrerId },
          })
          if (!referrerAccount) {
            throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
          }
          if (referrerAccount.status !== AccountStatus.ACTIVE) {
            throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '邀请人账户状态异常'))
          }

          // 邀请人用户校验
          const referrer = await tx.user.findUnique({
            where: { id: referral.referrerId },
          })
          if (!referrer) {
            throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
          }
          if (referrer.realNameStatus !== RealNameStatus.VERIFIED) {
            throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
          }
          if (referrer.status === UserStatus.FROZEN || referrer.status === UserStatus.INCOME_RESTRICTED) {
            throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '邀请人账户禁止收款'))
          }

          // 入账：邀请人 availableBalance 增加
          const updated = await tx.account.update({
            where: { id: referrerAccount.id },
            data: {
              availableBalance: { increment: rewardAmount },
              totalBalance: { increment: rewardAmount },
            },
          })

          // 创建交易订单（平台发放奖励，fromUserId=null 表示平台账户）
          const rewardOrderNo = generateOrderNo('RWD')
          const order2 = await tx.transactionOrder.create({
            data: {
              orderNo: rewardOrderNo,
              type: TransactionType.RECHARGE, // 平台入账（对账公式按 -奖励额 抵扣，见 reconciliation.service）
              status: TransactionStatus.SUCCESS,
              amount: rewardAmount,
              fromUserId: null,
              toUserId: referral.referrerId,
              remark: `邀请奖励 ${referral.referralNo}`,
              relatedOrderNo: referral.referralNo,
              completedAt: new Date(),
            },
          })

          // 账本：资金增加 = DEBIT（全库约定，与充值/收款一致）
          await tx.accountLedger.create({
            data: {
              accountId: referrerAccount.id,
              transactionId: order2.id,
              type: LedgerType.REFERRAL_REWARD,
              amount: rewardAmount,
              balanceBefore: updated.availableBalance - rewardAmount,
              balanceAfter: updated.availableBalance,
              direction: Direction.DEBIT,
              remark: `邀请奖励 ${referral.referralNo}`,
            },
          })

          // 账单
          await tx.bill.create({
            data: {
              userId: referral.referrerId,
              transactionId: order2.id,
              type: BillType.REFERRAL_REWARD,
              direction: BillDirection.INCOME,
              amount: rewardAmount,
              counterparty: '系统',
              remark: `邀请奖励 ${referral.referralNo}`,
            },
          })

          // 标记 Referral 已完成
          const updatedReferral = await tx.referral.update({
            where: { id: referral.id },
            data: {
              status: ReferralStatus.COMPLETED,
              rewardAmount,
              triggerTxNo: dto.transactionNo,
              completedAt: new Date(),
            },
          })

          return updatedReferral
        }),
    )
  }

  /** 取消邀请关系（仅 PENDING 状态） */
  async cancel(referrerId: string, referralNo: string, dto: CancelReferralDto) {
    const referral = await this.prisma.referral.findUnique({
      where: { referralNo },
    })
    if (!referral) {
      throw new NotFoundException(kbError(KBErrorCodes.REFERRAL_NOT_FOUND))
    }
    if (referral.referrerId !== referrerId) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '无权操作该邀请关系'))
    }
    if (referral.status !== ReferralStatus.PENDING) {
      throw new BadRequestException(kbError(KBErrorCodes.REFERRAL_STATUS_INVALID))
    }
    return this.prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: dto.reason,
      },
    })
  }

  // ============== 私有方法 ==============

  /** 生成全局唯一的邀请码 */
  private async generateUniqueCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = this.generateCode()
      const exists = await this.prisma.referralCode.findUnique({
        where: { code },
      })
      if (!exists) return code
    }
    throw new Error('生成邀请码失败：重试次数过多')
  }

  private generateCode(): string {
    const alphabet = ReferralsService.CODE_ALPHABET
    const bytes = randomBytes(REFERRAL_CODE_LENGTH)
    let result = ''
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
      result += alphabet[bytes[i] % alphabet.length]
    }
    return result
  }
}
