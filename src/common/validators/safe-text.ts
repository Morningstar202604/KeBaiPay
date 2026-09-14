import {
  IsString,
  MaxLength,
  MinLength,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator'

/**
 * 安全文本校验：用于会渲染到页面/账单/收银台的自由文本字段。
 *
 * 背景：前端（原生 SPA 与 Vue 三端）以"输出转义"为最终防线，但输入侧
 * 仍然收紧字符集做纵深防御——本装饰器拒绝 < 和 >（HTML 标签的最小构成）
 * 以及零宽字符（隐藏水印攻击），并统一长度上限。
 *
 * 注意：不替换 IsString，需与之搭配使用；数字/枚举/ID 字段不要套用。
 *
 * @example
 * ```ts
 * @IsSafeText(1, 50)
 * merchantName!: string
 * ```
 */
export function IsSafeText(minLength: number, maxLength: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    // 长度与类型交给 class-validator 内置装饰器，报错信息保持一致的中文风格
    IsString()(object, propertyName)
    MinLength(minLength, {
      ...(validationOptions as object),
      message: validationOptions?.message ?? `${propertyName} 长度不能少于 ${minLength} 个字符`,
    })(object, propertyName)
    MaxLength(maxLength, {
      ...(validationOptions as object),
      message: validationOptions?.message ?? `${propertyName} 长度不能超过 ${maxLength} 个字符`,
    })(object, propertyName)

    registerDecorator({
      name: 'isSafeText',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [minLength, maxLength],
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false
          if (/[<>]/.test(value)) return false
          // 零宽字符：U+200B-U+200F、U+202A-U+202E、U+2060-U+206F、U+FEFF
          if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(value)) return false
          return true
        },
        defaultMessage(args?: ValidationArguments): string {
          return `${args?.property ?? '该字段'} 不能包含 <、> 或不可见控制字符`
        },
      },
    })
  }
}

/** 常用上限，集中定义避免各 DTO 各写一个魔数 */
export const SAFE_TEXT_LIMITS = {
  /** 商户名 / 企业名 */
  MERCHANT_NAME: 50,
  /** 联系人姓名 */
  CONTACT_NAME: 30,
  /** 转账 / 红包 / 订单备注 */
  REMARK: 100,
  /** 商品标题 / 收款码备注 */
  SUBJECT: 64,
  /** 审核拒绝原因 */
  REJECT_REASON: 200,
} as const
