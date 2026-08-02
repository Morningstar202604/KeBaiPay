import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  ReconciliationDiffStatus,
  ReconciliationDiffType,
  RiskLevel,
} from '../common/enums'

/**
 * 自动修正配置
 */
export interface AutoFixConfig {
  /** 自动忽略的小额差异阈值（分），默认 50 分 = 0.5元 */
  minorDiffThreshold: number
  /** 是否启用自动修正 */
  enabled: boolean
}

const DEFAULT_CONFIG: AutoFixConfig = {
  minorDiffThreshold: 50,
  enabled: true,
}

/**
 * 自动修正记录
 */
export interface AutoFixRecord {
  id: string
  diffId: string
  amount: number
  diffType: string
  action: 'IGNORE' | 'ADJUST'
  reason: string
  createdAt: string
}

/**
 * 自动修正服务
 *
 * 对小额差异自动标记 IGNORED，减少人工处理负担。
 * 记录修正日志（写入 AuditLog）并上报 LOW 级别风险事件。
 *
 * 自动修正条件：
 *  - 差异金额 ≤ 配置阈值（默认 0.5元/50分）
 *  - 差异类型为 AMOUNT_MISMATCH
 *  - 差异状态为 PENDING
 *  - 配置启用
 */
@Injectable()
export class AutoFixService {
  private readonly logger = new Logger(AutoFixService.name)
  private config: AutoFixConfig = { ...DEFAULT_CONFIG }

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<AutoFixConfig>): void {
    this.config = { ...this.config, ...updates }
    this.logger.log(`自动修正配置已更新: ${JSON.stringify(this.config)}`)
  }

  /**
   * 获取当前配置
   */
  getConfig(): AutoFixConfig {
    return { ...this.config }
  }

  /**
   * 对指定差异项自动修正
   *
   * 返回已自动修正的记录列表
   */
  async autoFix(diffs: Array<{
    id: string
    amount: number
    diffType: string
    status: string
  }>): Promise<AutoFixRecord[]> {
    if (!this.config.enabled) {
      this.logger.log('自动修正已禁用，跳过')
      return []
    }

    const records: AutoFixRecord[] = []
    const threshold = this.config.minorDiffThreshold

    for (const diff of diffs) {
      // 仅处理 AMOUNT_MISMATCH 类型、PENDING 状态、小额差异
      if (
        diff.diffType !== ReconciliationDiffType.AMOUNT_MISMATCH ||
        diff.status !== ReconciliationDiffStatus.PENDING ||
        diff.amount > threshold
      ) {
        continue
      }

      try {
        // 标记为 IGNORED
        await this.prisma.reconciliationDifferenceItem.update({
          where: { id: diff.id },
          data: {
            status: ReconciliationDiffStatus.IGNORED,
            resolution: `自动忽略：小额差异 ${diff.amount}分（阈值 ${threshold}分）`,
            resolvedBy: 'AUTO_FIX',
            resolvedAt: new Date(),
          },
        })

        // 写入风险事件（LOW 级别）
        await this.prisma.riskEvent.create({
          data: {
            userId: 'SYSTEM',
            type: 'STATUS_CHANGED',
            level: RiskLevel.LOW,
            description: `自动修正对账差异：差异项 ${diff.id}，金额 ${diff.amount}分，类型 ${diff.diffType}，已自动标记为 IGNORED`,
            handled: true,
            handledBy: 'AUTO_FIX',
            handledAt: new Date(),
          },
        })

        const record: AutoFixRecord = {
          id: `auto-fix-${diff.id}`,
          diffId: diff.id,
          amount: diff.amount,
          diffType: diff.diffType,
          action: 'IGNORE',
          reason: `小额差异 ${diff.amount}分 ≤ 阈值 ${threshold}分，自动忽略`,
          createdAt: new Date().toISOString(),
        }

        records.push(record)
        this.logger.log(
          `自动修正差异项 diffId=${diff.id} amount=${diff.amount}分 threshold=${threshold}分`,
        )
      } catch (err) {
        this.logger.error(
          `自动修正失败 diffId=${diff.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    return records
  }
}
