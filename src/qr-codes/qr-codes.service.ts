import {
  Injectable,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '@prisma/client'
import {
  QrCodeType,
  QrCodeStatus,
} from '../common/enums'
import { generateQrCode, yuanToFen } from '../common/helpers'
import { KBErrorCodes, kbError } from '../common/error-codes'

@Injectable()
export class QrCodesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getPersonalCode(userId: string) {
    const code = await this.prisma.qrCode.findFirst({
      where: { userId, type: QrCodeType.PERSONAL, status: QrCodeStatus.ACTIVE },
    })
    if (code) return code

    // 并发场景下可能创建多条，通过 catch P2002 后重新查询避免
    try {
      return await this.prisma.qrCode.create({
        data: {
          code: generateQrCode(),
          userId,
          type: QrCodeType.PERSONAL,
          status: QrCodeStatus.ACTIVE,
        },
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // 并发创建导致 code 唯一冲突，重新查询即可
        const existing = await this.prisma.qrCode.findFirst({
          where: { userId, type: QrCodeType.PERSONAL, status: QrCodeStatus.ACTIVE },
        })
        if (existing) return existing
      }
      throw e
    }
  }

  async createFixedCode(
    userId: string,
    dto: { amount: number; remark?: string },
  ) {
    if (dto.amount <= 0) {
      throw new BadRequestException(kbError(KBErrorCodes.INVALID_PARAMETER))
    }
    const amount = yuanToFen(dto.amount)
    return this.prisma.qrCode.create({
      data: {
        code: generateQrCode(),
        userId,
        type: QrCodeType.FIXED_AMOUNT,
        amount,
        remark: dto.remark,
        status: QrCodeStatus.ACTIVE,
      },
    })
  }
}
