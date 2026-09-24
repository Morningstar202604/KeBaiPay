import { IsOptional, IsIn, IsInt, Min, Max } from 'class-validator'

/** 大额调账审批单状态（与 AdjustmentApproval.status 一致） */
export const ADJUSTMENT_APPROVAL_STATUSES = ['PENDING', 'EXECUTING', 'EXECUTED', 'REJECTED'] as const

export class ListAdjustmentsQueryDto {
  @IsOptional()
  @IsIn(ADJUSTMENT_APPROVAL_STATUSES, { message: '无效的审批单状态' })
  status?: (typeof ADJUSTMENT_APPROVAL_STATUSES)[number]

  // 分页参数：此前缺失导致全局 forbidNonWhitelisted 直接 400，分页永远不可用
  @IsOptional()
  @IsInt({ message: 'page 必须为整数' })
  @Min(1, { message: 'page 最小为 1' })
  page?: number

  @IsOptional()
  @IsInt({ message: 'limit 必须为整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(100, { message: 'limit 最大为 100' })
  limit?: number
}
