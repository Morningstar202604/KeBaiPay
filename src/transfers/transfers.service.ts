import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { Prisma, TransactionOrder } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  TransactionType,
  TransactionStatus,
  LedgerType,
  Direction,
  BillType,
  BillDirection,
  RealNameStatus,
  RiskLevel,
  RiskEventType,
  AccountStatus,
  UserStatus,
} from '../common/enums'
import { UsersService } from '../users/users.service'
import { RiskEngineService } from '../risk/risk-engine.service'
import { RedisService } from '../redis/redis.service'
import { fenToYuan, generateOrderNo, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { DEFAULT_TRANSFER_DAILY_LIMIT_CENTS, LARGE_TRANSFER_THRESHOLD_CENTS, REDIS_LOCK_TTL_SECONDS } from '../common/constants'

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly riskEngine: RiskEngineService,
    private readonly redis: RedisService,
  ) {}

  async transfer(
    fromUserId: string,
    dto: { toUserId: string; amount: number; remark?: string; payPassword: string; idempotencyKey?: string },
  ) {
    const lockKey = dto.idempotencyKey
      ? `transfer:idem:${dto.idempotencyKey}`
      : `transfer:user:${fromUserId}`
    return this.redis.withLock(lockKey, REDIS_LOCK_TTL_SECONDS, async () => {
      if (dto.amount <= 0) {
        throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_AMOUNT_INVALID))
      }
      if (fromUserId === dto.toUserId) {
        throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_TO_SELF))
      }

      // 实名与支付密码校验（与 agentTransfer 共享 validateParties）
      const { fromUser, toUser } = await this.validateParties(fromUserId, dto.toUserId)
      await this.usersService.verifyPayPassword(fromUserId, dto.payPassword)

      const amount = yuanToFen(dto.amount)

      // 风控检查：在事务前执行，拦截则直接抛错
      const riskResult = await this.riskEngine.check({
        userId: fromUserId,
        type: 'TRANSFER',
        amount,
      })
      if (riskResult.blocked) {
        throw new ForbiddenException(
          kbError(
            KBErrorCodes.FORBIDDEN,
            `交易被风控拦截：${riskResult.rules
              .filter((r) => r.action === 'BLOCK')
              .map((r) => r.name)
              .join('、')}`,
          ),
        )
      }

      const dateStr = new Date().toISOString().slice(0, 10)

      return this.prisma.$transaction(async (tx) => {
        // 单日限额校验放入事务内，保证原子性，避免高并发突破限额
        await this.checkDailyLimit(tx, fromUserId, dateStr, amount)

        return this.moveFundsAndRecord(tx, {
          fromUserId,
          toUserId: dto.toUserId,
          amountFen: amount,
          idempotencyKey: dto.idempotencyKey,
          fromNickname: fromUser.nickname,
          toNickname: toUser.nickname,
          orderRemark: dto.remark || '转账',
          expenseBillRemark: dto.remark || '转账',
          incomeBillRemark: dto.remark || '转账',
          senderLedgerRemark: `转账给 ${toUser.nickname}`,
          receiverLedgerRemark: `来自 ${fromUser.nickname} 的转账`,
          largeAmountDescription: `大额转账 ${fenToYuan(amount)} 元`,
        })
      }).then((order) => {
        // 转账成功后记录风控频率（不阻塞业务）
        this.riskEngine.recordTransaction({
          userId: fromUserId,
          type: 'TRANSFER',
          amount,
        }).catch((err) => {
          this.logger.warn(`recordTransaction(TRANSFER) 失败: ${err?.message || err}`)
        })
        return order
      })
    })
  }
  /**
   * Agent 代用户转账（智能体确认流程专用）
   *
   * 与 transfer() 的差异：
   *  - 免支付密码：资金操作已经过用户在 /agent/confirm 显式二次确认，
   *    该确认即为本操作的授权凭据（opLogId 同时用作幂等键，天然防重放）；
   *  - 强制 Agent 专项限额：单笔/单日上限来自 AGENT_MAX_AMOUNT_PER_OP /
   *    AGENT_MAX_AMOUNT_PER_DAY（分），独立于普通转账日限额；
   *  - 其余校验（实名/账户状态/风控/余额原子扣减/账本账单）与 transfer() 完全一致。
   */
  /**
   * Agent 代用户转账（智能体确认流程专用）
   *
   * 与 transfer() 的差异：
   *  - 免支付密码：资金操作已经过用户在 /agent/confirm 显式二次确认，
   *    该确认即为本操作的授权凭据（opLogId 同时用作幂等键，天然防重放）；
   *  - 强制 Agent 专项限额：单笔/单日上限来自 AGENT_MAX_AMOUNT_PER_OP /
   *    AGENT_MAX_AMOUNT_PER_DAY（分），独立于普通转账日限额；
   *  - 资金移动/账本/账单复用 moveFundsAndRecord 内核，与 transfer() 单一实现。
   */
  async agentTransfer(
    fromUserId: string,
    params: { toUserId: string; amountFen: number; remark?: string; idempotencyKey: string },
  ) {
    const { toUserId, amountFen, remark, idempotencyKey } = params
    if (!(amountFen > 0)) {
      throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_AMOUNT_INVALID))
    }
    if (fromUserId === toUserId) {
      throw new BadRequestException(kbError(KBErrorCodes.TRANSFER_TO_SELF))
    }

    const maxPerOp = Number(process.env.AGENT_MAX_AMOUNT_PER_OP) || 50000
    const maxPerDay = Number(process.env.AGENT_MAX_AMOUNT_PER_DAY) || 200000
    if (amountFen > maxPerOp) {
      throw new BadRequestException(
        kbError(KBErrorCodes.FORBIDDEN, `超过智能体单笔限额 ${fenToYuan(maxPerOp)} 元`),
      )
    }

    return this.redis.withLock(`agent-transfer:${idempotencyKey}`, REDIS_LOCK_TTL_SECONDS, async () => {
      const { fromUser, toUser } = await this.validateParties(fromUserId, toUserId)

      const riskResult = await this.riskEngine.check({
        userId: fromUserId,
        type: 'TRANSFER',
        amount: amountFen,
      })
      if (riskResult.blocked) {
        throw new ForbiddenException(
          kbError(
            KBErrorCodes.FORBIDDEN,
            `交易被风控拦截：${riskResult.rules
              .filter((r) => r.action === 'BLOCK')
              .map((r) => r.name)
              .join('、')}`,
          ),
        )
      }

      const dateStr = new Date().toISOString().slice(0, 10)

      return this.prisma.$transaction(async (tx) => {
        // Agent 专项单日累计限额（含本次）
        const dayStart = new Date(`${dateStr}T00:00:00.000Z`)
        const dayEnd = new Date(`${dateStr}T23:59:59.999Z`)
        const agentToday = await tx.transactionOrder.aggregate({
          where: {
            fromUserId,
            type: TransactionType.TRANSFER,
            status: TransactionStatus.SUCCESS,
            idempotencyKey: { startsWith: 'AGENT:' },
            completedAt: { gte: dayStart, lte: dayEnd },
          },
          _sum: { amount: true },
        })
        const agentTodayTotal = agentToday._sum.amount || 0
        if (agentTodayTotal + amountFen > maxPerDay) {
          throw new BadRequestException(
            kbError(KBErrorCodes.FORBIDDEN, `超过智能体单日限额 ${fenToYuan(maxPerDay)} 元`),
          )
        }

        // 普通转账日限额同样生效（Agent 转账也是转账）
        await this.checkDailyLimit(tx, fromUserId, dateStr, amountFen)

        const orderRemark = remark ? `${remark}（智能体代操作）` : '智能体代操作转账'
        return this.moveFundsAndRecord(tx, {
          fromUserId,
          toUserId,
          amountFen,
          idempotencyKey,
          fromNickname: fromUser.nickname,
          toNickname: toUser.nickname,
          orderRemark,
          expenseBillRemark: orderRemark,
          incomeBillRemark: '智能体代操作转账收款',
          senderLedgerRemark: `智能体代操作转账给 ${toUser.nickname}`,
          receiverLedgerRemark: `来自 ${fromUser.nickname} 的智能体代操作转账`,
          largeAmountDescription: `大额智能体转账 ${fenToYuan(amountFen)} 元`,
        })
      })
    }).then((order) => {
      // 转账成功后记录风控频率（不阻塞业务）
      this.riskEngine.recordTransaction({
        userId: fromUserId,
        type: 'TRANSFER',
        amount: amountFen,
      }).catch((err) => {
        this.logger.warn(`recordTransaction(AGENT TRANSFER) 失败: ${err?.message || err}`)
      })
      return order
    })
  }

  // ============== 共享内核 ==============

  /** 校验付款方/收款方用户状态（实名/冻结/风险等级），返回昵称供账本账单使用 */
  private async validateParties(fromUserId: string, toUserId: string) {
    const fromUser = await this.usersService.findById(fromUserId)
    if (!fromUser) throw new NotFoundException(kbError(KBErrorCodes.USER_NOT_FOUND))
    if (fromUser.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.REAL_NAME_REQUIRED))
    }
    if (fromUser.status === UserStatus.FROZEN || fromUser.status === UserStatus.EXPENSE_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户当前禁止支出'))
    }
    if (fromUser.riskLevel === RiskLevel.HIGH) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '账户风险等级过高，禁止转账'))
    }

    const toUser = await this.usersService.findById(toUserId)
    if (!toUser) throw new NotFoundException(kbError(KBErrorCodes.PAYEE_NOT_FOUND))
    if (toUser.realNameStatus !== RealNameStatus.VERIFIED) {
      throw new ForbiddenException(kbError(KBErrorCodes.PAYEE_NOT_VERIFIED))
    }
    if (toUser.status === UserStatus.FROZEN || toUser.status === UserStatus.INCOME_RESTRICTED) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '对方账户当前禁止收款'))
    }
    return { fromUser, toUser }
  }

  /** 普通转账单日限额（事务内原子校验+累加） */
  private async checkDailyLimit(tx: Prisma.TransactionClient, fromUserId: string, dateStr: string, amountFen: number) {
    const config = await tx.systemConfig.findUnique({
      where: { key: 'transfer_daily_limit' },
    })
    const limit = config ? Math.round(Number(config.value) * 100) : DEFAULT_TRANSFER_DAILY_LIMIT_CENTS
    await this.usersService.checkAndIncrementDailyLimit(
      tx,
      fromUserId,
      'TRANSFER',
      dateStr,
      amountFen,
      limit,
    )
  }

  /**
   * 资金移动 + 记账共享内核（必须在调用方的数据库事务内执行）：
   *  原子扣款(防透支) → 加款 → 订单 → 双方账本 → 双方账单 → 大额风控事件
   *
   * 幂等：idempotencyKey 存在时命中已有订单直接返回（校验归属）。
   * 备注/文案由调用方传入，保证 transfer() 与 agentTransfer() 输出与重构前一致。
   */
  private async moveFundsAndRecord(
    tx: Prisma.TransactionClient,
    p: {
      fromUserId: string
      toUserId: string
      amountFen: number
      idempotencyKey?: string
      fromNickname: string
      toNickname: string
      orderRemark: string
      expenseBillRemark: string
      incomeBillRemark: string
      senderLedgerRemark: string
      receiverLedgerRemark: string
      largeAmountDescription?: string
    },
  ): Promise<TransactionOrder> {
    // 幂等：命中已有订单则直接返回，不重复到账
    if (p.idempotencyKey) {
      const existing = await tx.transactionOrder.findUnique({
        where: { idempotencyKey: p.idempotencyKey },
      })
      if (existing) {
        // 校验归属：防止不同用户使用相同 idempotencyKey 获取他人订单
        if (existing.fromUserId !== p.fromUserId) {
          throw new BadRequestException(kbError(KBErrorCodes.IDEMPOTENCY_KEY_CONFLICT))
        }
        return existing
      }
    }

    const fromAccount = await tx.account.findUnique({
      where: { userId: p.fromUserId },
    })
    const toAccount = await tx.account.findUnique({
      where: { userId: p.toUserId },
    })
    if (!fromAccount || !toAccount) {
      throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
    }
    if (fromAccount.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '付款方账户状态异常'))
    }
    if (toAccount.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(kbError(KBErrorCodes.FORBIDDEN, '收款方账户状态异常'))
    }

    const orderNo = generateOrderNo('T')

    // 原子扣款：通过 updateMany + 余额条件避免并发透支
    const senderUpdate = await tx.account.updateMany({
      where: {
        id: fromAccount.id,
        availableBalance: { gte: p.amountFen },
      },
      data: {
        availableBalance: { decrement: p.amountFen },
        totalBalance: { decrement: p.amountFen },
      },
    })
    if (senderUpdate.count === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INSUFFICIENT_BALANCE))
    }

    // H1: updateMany 不返回更新后的记录，重新读取真实余额，保证账本 balanceBefore/After 准确
    const updatedFromAccount = await tx.account.findUnique({
      where: { id: fromAccount.id },
    })
    if (!updatedFromAccount) {
      throw new NotFoundException(kbError(KBErrorCodes.ACCOUNT_NOT_FOUND))
    }
    const senderBalanceAfter = updatedFromAccount.availableBalance
    // 扣款后余额 = 扣款前余额 - amount，故 balanceBefore = balanceAfter + amount
    const senderBalanceBefore = senderBalanceAfter + p.amountFen

    const updatedTo = await tx.account.update({
      where: { id: toAccount.id },
      data: {
        availableBalance: { increment: p.amountFen },
        totalBalance: { increment: p.amountFen },
      },
    })
    // H1: 加款方 balanceAfter 取 update 返回的真实值，balanceBefore = balanceAfter - amount
    const receiverBalanceAfter = updatedTo.availableBalance
    const receiverBalanceBefore = receiverBalanceAfter - p.amountFen

    // 幂等键唯一约束冲突时必须抛错让事务回滚，避免重复扣款被提交
    // 幂等返回在外层（事务外）处理
    const order = await tx.transactionOrder.create({
      data: {
        orderNo,
        type: TransactionType.TRANSFER,
        status: TransactionStatus.SUCCESS,
        amount: p.amountFen,
        fromUserId: p.fromUserId,
        toUserId: p.toUserId,
        remark: p.orderRemark,
        idempotencyKey: p.idempotencyKey,
        completedAt: new Date(),
      },
    })

    await tx.accountLedger.create({
      data: {
        accountId: fromAccount.id,
        transactionId: order.id,
        type: LedgerType.TRANSFER,
        amount: p.amountFen,
        balanceBefore: senderBalanceBefore,
        balanceAfter: senderBalanceAfter,
        direction: Direction.CREDIT,
        remark: p.senderLedgerRemark,
      },
    })

    await tx.accountLedger.create({
      data: {
        accountId: toAccount.id,
        transactionId: order.id,
        type: LedgerType.TRANSFER,
        amount: p.amountFen,
        balanceBefore: receiverBalanceBefore,
        balanceAfter: receiverBalanceAfter,
        direction: Direction.DEBIT,
        remark: p.receiverLedgerRemark,
      },
    })

    await tx.bill.create({
      data: {
        userId: p.fromUserId,
        transactionId: order.id,
        type: BillType.TRANSFER,
        direction: BillDirection.EXPENSE,
        amount: p.amountFen,
        counterparty: p.toNickname,
        remark: p.expenseBillRemark,
      },
    })
    await tx.bill.create({
      data: {
        userId: p.toUserId,
        transactionId: order.id,
        type: BillType.RECEIPT,
        direction: BillDirection.INCOME,
        amount: p.amountFen,
        counterparty: p.fromNickname,
        remark: p.incomeBillRemark,
      },
    })

    if (p.amountFen > LARGE_TRANSFER_THRESHOLD_CENTS) {
      await tx.riskEvent.create({
        data: {
          userId: p.fromUserId,
          type: RiskEventType.LARGE_TRANSFER,
          level: RiskLevel.MEDIUM,
          description: p.largeAmountDescription ?? `大额转账 ${fenToYuan(p.amountFen)} 元`,
        },
      })
    }

    return order
  }

}