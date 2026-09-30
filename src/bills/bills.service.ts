import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import { BillDirection, PaymentOrderStatus } from '../common/enums'
import { BILL_LIST_LIMIT } from '../common/constants'

/**
 * 账单服务（合规聚合模式）：
 * 平台无用户余额/资金流水，账单改为「我作为付款方的收单订单」。
 * direction=EXPENSE 时仅返回已支付/已退款订单（支出的语义）。
 */
@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUser(userId: string, direction?: BillDirection) {
    const where: Prisma.PaymentOrderWhereInput = { payerId: userId }
    if (direction === BillDirection.EXPENSE) {
      where.status = { in: [PaymentOrderStatus.PAID, PaymentOrderStatus.REFUNDED] }
    }
    return this.prisma.paymentOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: BILL_LIST_LIMIT,
    })
  }
}
