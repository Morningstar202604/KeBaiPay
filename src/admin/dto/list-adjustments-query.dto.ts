import { IsOptional, IsIn } from 'class-validator'

/** 大额调账审批单状态（与 AdjustmentApproval.status 一致） */
export const ADJUSTMENT_APPROVAL_STATUSES = ['PENDING', 'EXECUTING', 'EXECUTED', 'REJECTED'] as const

export class ListAdjustmentsQueryDto {
  @IsOptional()
  @IsIn(ADJUSTMENT_APPROVAL_STATUSES, { message: '无效的审批单状态' })
  status?: (typeof ADJUSTMENT_APPROVAL_STATUSES)[number]
}
