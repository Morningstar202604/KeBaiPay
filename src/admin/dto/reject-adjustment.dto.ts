import { IsOptional, IsString } from 'class-validator'
import { IsSafeText } from '../../common/validators/safe-text'

/** 驳回大额调账申请：驳回原因可选但建议填写（写入审批单与审计日志） */
export class RejectAdjustmentDto {
  @IsOptional()
  @IsString()
  @IsSafeText(0, 200)
  reason?: string
}
