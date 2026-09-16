import { IsNotEmpty, IsNumber, IsString, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { IsSafeText } from '../../common/validators/safe-text'

export class AdjustAccountDto {
  // 允许负数表示扣款（服务层以符号区分加/扣款）。
  // - 绝对值上限复用平台单笔 50 万元语义，超限走 400 而非 yuanToFen 的裸 Error(500)；
  // - maxDecimalPlaces=2：金额最小单位是分，拒绝亚分金额（如 0.001 会被四舍五入成
  //   0 分，产生一条金额为 0 的调账流水，污染账本）。
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount 必须为最多 2 位小数的数字' })
  @Min(-500000, { message: '单笔调账下限 -500000 元' })
  @Max(500000, { message: '单笔调账上限 500000 元' })
  @Type(() => Number)
  amount!: number

  @IsSafeText(1, 200)
  reason!: string
}
