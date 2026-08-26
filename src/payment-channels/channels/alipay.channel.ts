import { Injectable, Logger } from '@nestjs/common'
import { AlipaySdk } from 'alipay-sdk'
import {
  PaymentChannel,
  RechargeRequest,
  RechargeResponse,
  RechargeCallbackResult,
  PayoutRequest,
  PayoutResponse,
  PayoutQueryResult,
  RefundRequest,
  RefundResponse,
  RefundQueryResult,
  RefundCallbackResult,
  OrderQueryResult,
  ChannelConfig,
} from '../payment-channel.interface'
import { KBErrorCodes, kbError } from '../../common/error-codes'

/**
 * 支付宝支付渠道适配器
 *
 * 支持支付方式：
 *   page - 电脑网站支付 (alipay.trade.page.pay)
 *   wap  - 手机网站支付 (alipay.trade.wap.pay)
 *
 * 配置字段 (存储在 PaymentChannelConfig.config JSON 中):
 *   appId       - 支付宝应用ID
 *   privateKey  - 应用私钥 (PEM字符串，PKCS8格式)
 *   alipayPublicKey - 支付宝公钥
 *   notifyUrl   - 异步通知地址
 *   returnUrl   - 同步跳转地址(电脑网站支付)
 *   signType    - 签名类型 (RSA2)
 *   sandbox     - 是否沙箱环境
 *
 * 签名、网关请求与通知验签统一委托给官方 alipay-sdk 实现。
 */
@Injectable()
export class AlipayChannel implements PaymentChannel {
  readonly code = 'alipay'
  readonly name = '支付宝'
  private readonly logger = new Logger(AlipayChannel.name)

  private readonly ALIPAY_GATEWAY = 'https://openapi.alipay.com/gateway.do'
  private readonly ALIPAY_GATEWAY_DEV = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'

  /**
   * 基于渠道配置构建官方 SDK 实例
   */
  private buildSdk(channelConfig: ChannelConfig): AlipaySdk {
    const appId = channelConfig.appId as string
    const privateKey = channelConfig.privateKey as string
    const alipayPublicKey = channelConfig.alipayPublicKey as string | undefined
    const sandbox = channelConfig.sandbox === true || channelConfig.sandbox === 'true'

    return new AlipaySdk({
      appId,
      privateKey,
      alipayPublicKey,
      signType: 'RSA2',
      keyType: 'PKCS8',
      camelcase: false,
      gateway: sandbox ? this.ALIPAY_GATEWAY_DEV : this.ALIPAY_GATEWAY,
    })
  }

  /**
   * 解析表单通知参数
   */
  private parseNotifyParams(rawBody: string): Record<string, string> {
    const params: Record<string, string> = {}
    const searchParams = new URLSearchParams(rawBody)
    searchParams.forEach((value, key) => {
      params[key] = value
    })
    return params
  }

  /**
   * 验证回调签名（公开方法供 webhook 使用）
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): boolean {
    const alipayPublicKey = channelConfig.alipayPublicKey as string
    if (!alipayPublicKey) {
      this.logger.error('支付宝公钥未配置，拒绝回调签名验证')
      return false
    }

    let sdk: AlipaySdk
    try {
      sdk = this.buildSdk(channelConfig)
    } catch {
      this.logger.error('支付宝 SDK 初始化失败，拒绝回调签名验证')
      return false
    }

    const params = this.parseNotifyParams(rawBody)
    return sdk.checkNotifySignV2(params)
  }

  /**
   * 构建支付请求（page 或 wap）
   */
  private buildPayRequest(
    params: RechargeRequest,
    payMethod: 'page' | 'wap',
  ): { payUrl: string; channelOrderNo: string } {
    const cfg = params.channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string
    const notifyUrl = (cfg.notifyUrl as string) || params.notifyUrl
    const returnUrl = (cfg.returnUrl as string) || ''

    if (!appId || !privateKey) {
      throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '支付宝配置不完整：缺少 appId/privateKey'))
    }

    const productCode = payMethod === 'page' ? 'FAST_INSTANT_TRADE_PAY' : 'QUICK_WAP_WAY'
    const method = payMethod === 'page' ? 'alipay.trade.page.pay' : 'alipay.trade.wap.pay'

    const sdk = this.buildSdk(cfg)
    const payUrl = sdk.pageExecute(method, 'GET', {
      bizContent: {
        out_trade_no: params.orderNo,
        total_amount: (params.amount / 100).toFixed(2),
        subject: params.subject,
        product_code: productCode,
      },
      notify_url: notifyUrl,
      ...(returnUrl ? { return_url: returnUrl } : {}),
    })

    return {
      payUrl,
      channelOrderNo: params.orderNo,
    }
  }

  async createRecharge(params: RechargeRequest): Promise<RechargeResponse> {
    const payMethod = (params.payMethod as 'page' | 'wap') || 'wap'
    const { payUrl, channelOrderNo } = this.buildPayRequest(params, payMethod)

    return {
      channelOrderNo,
      payUrl,
      payParams: { pay_url: payUrl } as ChannelConfig,
      status: 'PENDING',
    }
  }

  /**
   * 查询支付订单状态
   */
  async queryOrder(
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<OrderQueryResult> {
    const cfg = channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    const sdk = this.buildSdk(cfg)

    try {
      const result = await sdk.exec(
        'alipay.trade.query',
        { bizContent: { out_trade_no: channelOrderNo } },
        { validateSign: false },
      )

      if (result.code !== '10000') {
        return {
          channelOrderNo,
          status: 'FAILED',
          totalAmount: 0,
          message: (result.sub_msg as string) || (result.msg as string) || '查询失败',
        }
      }

      const tradeStatus = result.trade_status as string
      const totalAmountStr = result.total_amount as string
      const totalAmount = Math.round(parseFloat(totalAmountStr || '0') * 100)
      const gmtPayment = result.send_pay_date as string

      let status: OrderQueryResult['status']
      switch (tradeStatus) {
        case 'TRADE_SUCCESS':
        case 'TRADE_FINISHED':
          status = 'SUCCESS'
          break
        case 'TRADE_CLOSED':
          status = 'CLOSED'
          break
        case 'WAIT_BUYER_PAY':
          status = 'PENDING'
          break
        default:
          status = 'FAILED'
      }

      return {
        channelOrderNo,
        status,
        totalAmount,
        paidAt: gmtPayment ? new Date(gmtPayment) : undefined,
        message: tradeStatus,
      }
    } catch (error) {
      this.logger.error(`支付宝订单查询异常: ${error}`)
      return {
        channelOrderNo,
        status: 'PENDING',
        totalAmount: 0,
        message: '查询失败，请稍后重试',
      }
    }
  }

  parseRechargeCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): RechargeCallbackResult {
    const cfg = channelConfig
    const alipayPublicKey = cfg.alipayPublicKey as string

    if (!alipayPublicKey) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝公钥未配置，无法验证回调签名'))
    }

    const sdk = this.buildSdk(cfg)
    const params = this.parseNotifyParams(rawBody)

    if (!sdk.checkNotifySignV2(params)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝回调签名验证失败'))
    }

    const tradeStatus = params.trade_status
    const status = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED' ? 'SUCCESS' : 'FAILED'

    const totalAmount = parseFloat(params.total_amount || '0')
    const amountFen = Math.round(totalAmount * 100)

    return {
      channelOrderNo: params.trade_no || params.out_trade_no,
      orderNo: params.out_trade_no,
      amount: amountFen,
      status,
      signature: params.sign || '',
    }
  }

  buildRechargeCallbackSuccess(): string {
    return 'success'
  }

  /**
   * 发起退款
   *
   * 支付宝退款接口：alipay.trade.refund
   */
  async refund(params: RefundRequest): Promise<RefundResponse> {
    const cfg = params.channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '支付宝配置不完整'))
    }

    const sdk = this.buildSdk(cfg)

    try {
      const result = await sdk.exec(
        'alipay.trade.refund',
        {
          bizContent: {
            out_trade_no: params.orderNo,
            refund_amount: (params.amount / 100).toFixed(2),
            refund_reason: params.reason || '用户退款',
            out_request_no: params.refundNo,
          },
        },
        { validateSign: false },
      )

      if (result.code !== '10000') {
        this.logger.error(`支付宝退款失败: ${JSON.stringify(result)}`)
        throw new Error(`支付宝退款失败: ${result.sub_msg || result.msg || '未知错误'}`)
      }

      return {
        // channelRefundNo 编码 trade_no 与 out_request_no，供 queryRefund 调用
        // alipay.trade.fastpay.refund.query 接口（要求 out_request_no + trade_no/out_trade_no）
        channelRefundNo: `${result.trade_no}:${params.refundNo}`,
        status: 'PENDING',
        message: '退款受理中',
      }
    } catch (error) {
      this.logger.error(`支付宝退款调用异常: ${error}`)
      throw error
    }
  }

  /**
   * 查询退款状态
   *
   * 调用 alipay.trade.fastpay.refund.query 接口，按 out_request_no 精确查询单笔退款状态。
   * channelRefundNo 格式为 `${trade_no}:${out_request_no}`，由 refund() 方法生成。
   */
  async queryRefund(
    channelRefundNo: string,
    channelConfig: ChannelConfig,
  ): Promise<RefundQueryResult> {
    const cfg = channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    // 解析 refund() 编码的 trade_no 与 out_request_no
    const sepIdx = channelRefundNo.lastIndexOf(':')
    if (sepIdx <= 0 || sepIdx === channelRefundNo.length - 1) {
      return {
        channelRefundNo,
        status: 'FAILED',
        message: 'channelRefundNo 格式非法，无法查询',
      }
    }
    const tradeNo = channelRefundNo.slice(0, sepIdx)
    const outRequestNo = channelRefundNo.slice(sepIdx + 1)

    // 支付宝退款查询接口：要求 out_request_no + (out_trade_no 或 trade_no)
    const sdk = this.buildSdk(cfg)

    try {
      const result = await sdk.exec(
        'alipay.trade.fastpay.refund.query',
        { bizContent: { trade_no: tradeNo, out_request_no: outRequestNo } },
        { validateSign: false },
      )

      if (result.code !== '10000') {
        return {
          channelRefundNo,
          status: 'FAILED',
          message: (result.sub_msg as string) || '查询失败',
        }
      }

      // refund_status = 'REFUND_SUCCESS' 表示该笔退款成功
      if (result.refund_status === 'REFUND_SUCCESS') {
        return {
          channelRefundNo,
          status: 'SUCCESS',
          message: '退款成功',
        }
      }

      return {
        channelRefundNo,
        status: 'PENDING',
        message: '退款处理中',
      }
    } catch {
      return {
        channelRefundNo,
        status: 'PENDING',
        message: '查询失败，请稍后重试',
      }
    }
  }

  /**
   * 解析退款回调
   */
  parseRefundCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): RefundCallbackResult {
    const cfg = channelConfig
    const alipayPublicKey = cfg.alipayPublicKey as string

    if (!alipayPublicKey) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝公钥未配置'))
    }

    const sdk = this.buildSdk(cfg)
    const params = this.parseNotifyParams(rawBody)

    if (!sdk.checkNotifySignV2(params)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝退款回调签名验证失败'))
    }

    const totalAmount = parseFloat(params.total_amount || '0')
    const amountFen = Math.round(totalAmount * 100)

    return {
      channelRefundNo: params.trade_no || '',
      orderNo: params.out_trade_no || '',
      refundNo: params.out_request_no || '',
      amount: amountFen,
      status: 'SUCCESS',
      signature: params.sign || '',
    }
  }

  buildRefundCallbackSuccess(): string {
    return 'success'
  }

  async createPayout(params: PayoutRequest): Promise<PayoutResponse> {
    const cfg = params.channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    const sdk = this.buildSdk(cfg)

    try {
      const result = await sdk.exec(
        'alipay.fund.trans.uni.transfer',
        {
          bizContent: {
            out_biz_no: params.orderNo,
            payee_type: 'ALIPAY_LOGON_ID',
            payee_account: params.channelAccount,
            amount: (params.amount / 100).toFixed(2),
            remark: `提现_${params.userName}`,
          },
        },
        { validateSign: false },
      )

      if (result.code !== '10000') {
        this.logger.error(`支付宝转账失败: ${JSON.stringify(result)}`)
        throw new Error(`支付宝转账失败: ${result.sub_msg || result.msg || '未知错误'}`)
      }

      return {
        // 语义约定：channelOrderNo 恒为渠道侧单号（支付宝 order_id）。
        // 极端情况下渠道未返回 order_id 时回退我方单号占位，
        // 回调匹配逻辑对这两种取值均兼容（见 withdrawals.service.handlePayoutCallback）。
        channelOrderNo: (result.order_id as string) || params.orderNo,
        status: 'PROCESSING',
        message: '转账受理中',
      }
    } catch (error) {
      this.logger.error(`支付宝转账调用异常: ${error}`)
      throw error
    }
  }

  async queryPayout(
    channelOrderNo: string,
    channelConfig: ChannelConfig,
  ): Promise<PayoutQueryResult> {
    const cfg = channelConfig
    const appId = cfg.appId as string
    const privateKey = cfg.privateKey as string

    if (!appId || !privateKey) {
      throw new Error('支付宝配置不完整')
    }

    const sdk = this.buildSdk(cfg)

    try {
      const result = await sdk.exec(
        'alipay.fund.trans.order.query',
        // createPayout 持久化的是渠道侧单号（order_id），查询必须用同一字段；
        // 此前误将其作为 out_biz_no（我方单号）查询，永远查不到订单
        { bizContent: { order_id: channelOrderNo } },
        { validateSign: false },
      )

      if (result.status === 'SUCCESS') {
        return { channelOrderNo, status: 'SUCCESS', message: '转账成功' }
      } else if (result.status === 'FAIL') {
        return { channelOrderNo, status: 'FAILED', message: '转账失败' }
      }
      return { channelOrderNo, status: 'PROCESSING', message: '转账处理中' }
    } catch {
      return { channelOrderNo, status: 'PROCESSING', message: '查询失败，请稍后重试' }
    }
  }

  parsePayoutCallback(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): {
    channelOrderNo: string
    orderNo: string
    status: 'SUCCESS' | 'FAILED'
    signature: string
  } {
    const alipayPublicKey = channelConfig.alipayPublicKey as string
    if (!alipayPublicKey) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝公钥未配置'))
    }

    const sdk = this.buildSdk(channelConfig)
    const params = this.parseNotifyParams(rawBody)

    // 必须验签：否则攻击者可伪造 payout 成功回调，触发提现订单误标 SUCCESS
    // 导致资金已扣但实际未到账的严重资金事故
    if (!sdk.checkNotifySignV2(params)) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '支付宝代付回调签名验证失败'))
    }

    // 支付宝转账异步通知同时携带 out_biz_no（我方单号）与 order_id（渠道侧单号）。
    // 语义约定：channelOrderNo 恒取渠道侧单号 order_id，orderNo 取我方单号 out_biz_no。
    // 此前两者都填 out_biz_no，与 createPayout 存储的 order_id 恒不匹配，
    // 导致真实回调必然命中 CALLBACK_CHANNEL_ORDER_NO_MISMATCH、订单卡死 PROCESSING。
    return {
      channelOrderNo: params.order_id || '',
      orderNo: params.out_biz_no || '',
      status: params.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      signature: params.sign || '',
    }
  }

  buildPayoutCallbackSuccess(): string {
    return 'success'
  }
}
