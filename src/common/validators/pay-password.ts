import { ValidationOptions, registerDecorator } from 'class-validator'

/**
 * 支付密码统一校验装饰器。
 *
 * 背景：支付密码是资金类操作（充值 / 转账 / 提现 / 红包 / 订阅 / 批量转账 /
 * 收银台 / 担保交易 / 扫码付款）的授权凭据，全平台必须采用同一套规则，
 * 否则会出现"重置接口允许 6 位纯数字、使用接口却接受任意 6 位字母数字、
 * 其余 6 个入口完全不校验"的规则漂移——既是不一致的业务逻辑，也是安全短板。
 *
 * 规则与仓库既定意图保持一致（见 reset-pay-password / verify-identity 的注释）：
 * 6 位纯数字，与银行支付密码惯例一致。@Matches 同时隐式要求字符串类型与非空，
 * 故不再叠加 IsString / IsNotEmpty（避免重复装饰导致报错信息歧义）。
 *
 * @example
 * ```ts
 * @IsPayPassword()
 * payPassword!: string
 * ```
 */
export const PAY_PASSWORD_REGEX = /^\d{6}$/

export function IsPayPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPayPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && PAY_PASSWORD_REGEX.test(value)
        },
        defaultMessage(): string {
          return '支付密码必须为 6 位纯数字'
        },
      },
    })
  }
}
