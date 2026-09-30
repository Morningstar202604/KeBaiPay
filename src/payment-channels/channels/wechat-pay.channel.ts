import { Injectable, Logger } from '@nestjs/common'
import Pay from 'wechatpay-node-v3'
import { createPublicKey, createVerify } from 'crypto'
import {
  PaymentChannel,
  RechargeRequest,
  RechargeResponse,
  RechargeCallbackResult,
  RefundRequest,
  RefundResponse,
  RefundQueryResult,
  RefundCallbackResult,
  OrderQueryResult,
  ChannelConfig,
} from '../payment-channel.interface'
import { KBErrorCodes, kbError } from '../../common/error-codes'

/**
 * 微信支付 V3 渠道适配器
 *
 * 支持支付方式：
 *   native  - 电脑网站扫码支付
 *   jsapi   - 微信内H5支付（公众号/小程序）
 *   h5      - 手机浏览器支付
 *
 * 配置字段 (存储在 PaymentChannelConfig.config JSON 中):
 *   appid       - 商户绑定的应用ID
 *   mchid       - 商户号
 *   serialNo    - 商户API证书序列号
 *   privateKey  - 商户API私钥 (PEM字符串)
 *   apiV3Key    - APIv3密钥
 *   notifyUrl   - 回调通知地址
 *   platformCert - 平台证书公钥（用于验签回调）
 *
 * 请求签名、下单、查询、退款、转账与回调解密统一委托给
 * wechatpay-node-v3 实现；回调验签为离线 RSA-SHA256 校验（保持同步契约）。
 */
@Injectable()
export class WechatPayChannel implements PaymentChannel {
  readonly code = 'wechat'
  readonly name = '微信支付'
  private readonly logger = new Logger(WechatPayChannel.name)

  /**
   * 基于渠道配置构建 SDK 客户端
   *
   * decryptOnly 模式（回调解密）仅需要 apiV3Key，不校验商户密钥。
   * 此时 SDK 实例仅用于 decipher_gcm，不发起签名请求，商户字段用占位值即可。
   */
  private buildPayClient(channelConfig: ChannelConfig, decryptOnly = false): Pay {
    const appid = (channelConfig.appid as string) || 'default'
    const mchid = (channelConfig.mchid as string) || 'default'
    const serialNo = (channelConfig.serialNo as string) || 'default'
    const privateKey = channelConfig.privateKey as string | undefined
    const apiV3Key = channelConfig.apiV3Key as string | undefined

    if (!decryptOnly) {
      if (!channelConfig.appid || !channelConfig.mchid || !privateKey) {
        throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '微信支付配置不完整：缺少 appid/mchid/privateKey'))
      }
      if (!channelConfig.serialNo) {
        throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, '微信支付配置不完整：缺少 serialNo'))
      }
    }

    // SDK 需要商户证书公钥；由私钥推导，serialNo 已显式提供，无需加载证书文件
    const publicKey = privateKey
      ? createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
      : 'placeholder'

    return new Pay({
      appid,
      mchid,
      serial_no: serialNo,
      publicKey: Buffer.from(publicKey),
      privateKey: Buffer.from(privateKey || 'placeholder'),
      key: apiV3Key,
    })
  }

  /**
   * 验证 V3 回调签名（离线，使用配置的平台证书公钥）
   */
  private verifyV3(
    timestamp: string,
    nonce: string,
    body: string,
    signature: string,
    platformCert: string,
  ): boolean {
    const message = `${timestamp}\n${nonce}\n${body}\n`
    const verify = createVerify('RSA-SHA256')
    verify.update(message)
    return verify.verify(platformCert, signature, 'base64')
  }

  /**
   * 获取平台证书（从配置或缓存）
   */
  private getPlatformCert(channelConfig: ChannelConfig): string | null {
    return (channelConfig.platformCert as string) || null
  }

  /**
   * 验证回调签名（公开方法供 webhook 使用）
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    channelConfig: ChannelConfig,
  ): boolean {
    const timestamp = headers['wechatpay-timestamp'] || ''
    const nonce = headers['wechatpay-nonce'] || ''
    const signature = headers['wechatpay-signature'] || ''
    const platformCert = this.getPlatformCert(channelConfig)

    if (!platformCert) {
      this.logger.error('平台证书未配置，拒绝回调签名验证')
      return false
    }

    // M2 修复：时间戳时效校验（±5 分钟）。微信 V3 验签本身不含新鲜度，
    // 不校验则历史合法回调可被无限期重放（业务幂等为兜底，此处补纵深防御）
    const timestampSeconds = Number.parseInt(timestamp, 10)
    if (!Number.isFinite(timestampSeconds)) {
      this.logger.warn(`微信回调时间戳缺失或非法: "${timestamp}"，拒绝处理`)
      return false
    }
    const skewSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds)
    if (skewSeconds > 300) {
      this.logger.warn(`微信回调时间戳偏差 ${skewSeconds}s 超过 300s 窗口，疑似重放，拒绝处理`)
      return false
    }

    return this.verifyV3(timestamp, nonce, rawBody, signature, platformCert)
  }

  async createRecharge(params: RechargeRequest): Promise<RechargeResponse> {
    const cfg = params.channelConfig
    const appid = cfg.appid as string
    const notifyUrl = (cfg.notifyUrl as string) || params.notifyUrl
    const payMethod = params.payMethod || 'native'

    const pay = this.buildPayClient(cfg)

    const baseOrder = {
      description: params.subject,
      out_trade_no: params.orderNo,
      notify_url: notifyUrl,
      amount: {
        total: params.amount,
        currency: 'CNY',
      },
    }

    let result: { status: number; data?: Record<string, unknown>; error?: unknown; errRaw?: unknown }
    switch (payMethod) {
      case 'jsapi': {
        if (!params.openid) {
          throw new Error(kbError(KBErrorCodes.RECHARGE_CHANNEL_FAILED, 'JSAPI 支付需要提供 openid'))
        }
        result = await pay.transactions_jsapi({
          ...baseOrder,
          payer: { openid: params.openid },
        })
        break
      }
      case 'h5': {
        result = await pay.transactions_h5({
          ...baseOrder,
          scene_info: {
            // P1-5：必须传真实终端 IP，微信侧硬编码 127.0.0.1 会触发风控/被拒；
            // 取不到（如无代理头的服务端直连）时兜底
            payer_client_ip: params.clientIp || '127.0.0.1',
            h5_info: {
              type: 'Wap',
              app_url: (cfg.wapUrl as string) || 'https://www.example.com',
              app_name: (cfg.wapName as string) || 'KeBaiPay',
            },
          },
        })
        break
      }
      case 'native':
      default: {
        result = await pay.transactions_native(baseOrder)
        break
      }
    }

    if (result.status !== 200) {
      this.logger.error(`微信支付下单失败: ${JSON.stringify(result)}`)
      throw new Error(`微信支付下单失败: ${typeof result.error === 'string' ? result.error : '渠道请求异常'}`)
    }

    const data = (result.data || {}) as Record<string, any>
    let payUrl: string | undefined
    const payParams: ChannelConfig = {}

    switch (payMethod) {
      case 'jsapi': {
        // SDK 已生成 appId/timeStamp/nonceStr/package/paySign，按其值重建业务侧 payParams 结构
        const prepayId = String(data.package || '').replace(/^prepay_id=/, '')
        const timestamp = (data.timeStamp as string) || String(Math.floor(Date.now() / 1000))
        const nonceStr = (data.nonceStr as string) || ''
        payParams.prepay_id = prepayId
        payParams.appid = appid
        payParams.timestamp = timestamp
        payParams.nonce_str = nonceStr
        payParams.package = `prepay_id=${prepayId}`
        payParams.signType = 'RSA2'
        // 优先使用 SDK 返回的 paySign（微信侧签发，参数一致时权威），缺失时才按 V3 规则兜底自算
        payParams.paySign = (data.paySign as string) ||
          pay.sha256WithRsa(`${appid}\n${timestamp}\n${nonceStr}\nprepay_id=${prepayId}\n`)
        break
      }
      case 'h5':
        payUrl = (data.h5_url as string) || undefined
        payParams.h5_url = payUrl
        break
      case 'native':
      default:
        payUrl = (data.code_url as string) || undefined
        payParams.code_url = payUrl
        break
    }

    return {
      channelOrderNo: params.orderNo,
      payUrl,
      payParams,
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
    const pay = this.buildPayClient(channelConfig)

    try {
      const result = await pay.query({ out_trade_no: channelOrderNo })

      if (result.status !== 200) {
        return {
          channelOrderNo,
          status: 'FAILED',
          totalAmount: 0,
          message: '查询失败',
        }
      }

      const data = (result.data || {}) as Record<string, any>
      const tradeState = data.trade_state as string
      const totalAmount = (data.amount as Record<string, unknown>)?.total as number || 0
      const successTime = data.success_time as string

      let status: OrderQueryResult['status']
      switch (tradeState) {
        case 'SUCCESS':
          status = 'SUCCESS'
          break
        case 'CLOSED':
        case 'REVOKED':
          status = 'CLOSED'
          break
        case 'NOTPAY':
        case 'USERPAYING':
          status = 'PENDING'
          break
        default:
          status = 'FAILED'
      }

      return {
        channelOrderNo,
        status,
        totalAmount,
        paidAt: successTime ? new Date(successTime) : undefined,
        message: tradeState,
      }
    } catch (error) {
      this.logger.error(`微信支付查询异常: ${error}`)
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
    const apiV3Key = cfg.apiV3Key as string

    if (!apiV3Key) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付 APIv3 密钥未配置'))
    }

    const pay = this.buildPayClient(cfg, true)

    let body: { resource: { ciphertext: string; nonce: string; associated_data: string }; out_trade_no: string }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付回调 body 非 JSON'))
    }

    let resource: { out_trade_no: string; transaction_id: string; trade_state: string; amount: { total: number } }
    try {
      const decrypted = pay.decipher_gcm<unknown>(
        body.resource.ciphertext,
        body.resource.associated_data,
        body.resource.nonce,
        apiV3Key,
      )
      if (typeof decrypted !== 'object' || decrypted === null) {
        throw new Error('decrypt not json')
      }
      resource = decrypted as { out_trade_no: string; transaction_id: string; trade_state: string; amount: { total: number } }
    } catch (error) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付回调解密失败'))
    }

    const status = resource.trade_state === 'SUCCESS' ? 'SUCCESS' : 'FAILED'

    return {
      channelOrderNo: resource.transaction_id || body.out_trade_no,
      orderNo: resource.out_trade_no,
      amount: resource.amount?.total || 0,
      status,
      signature: headers['wechatpay-signature'] || '',
    }
  }

  buildRechargeCallbackSuccess(): string {
    return JSON.stringify({ code: 'SUCCESS', message: '成功' })
  }

  /**
   * 发起退款
   *
   * 微信支付 V3 退款接口：POST /v3/refund/domestic/refunds
   */
  async refund(params: RefundRequest): Promise<RefundResponse> {
    const cfg = params.channelConfig
    const notifyUrl = (cfg.refundNotifyUrl as string) || (cfg.notifyUrl as string)
    const pay = this.buildPayClient(cfg)

    try {
      const result = await pay.refunds({
        out_trade_no: params.orderNo,
        out_refund_no: params.refundNo,
        reason: params.reason || '用户退款',
        notify_url: notifyUrl,
        amount: {
          refund: params.amount,
          // P1-4：微信要求 total=原订单支付金额。部分退款时若错填退款金额会被渠道拒绝；
          // 未传 originalAmount 时（全额退款）回退为退款金额
          total: params.originalAmount ?? params.amount,
          currency: 'CNY',
        },
      })

      if (result.status !== 200) {
        this.logger.error(`微信退款失败: ${JSON.stringify(result)}`)
        throw new Error(`微信退款失败: ${typeof result.error === 'string' ? result.error : '渠道请求异常'}`)
      }

      const data = (result.data || {}) as Record<string, any>
      const status = data.status as string
      let refundStatus: RefundResponse['status']
      switch (status) {
        case 'SUCCESS':
          refundStatus = 'SUCCESS'
          break
        case 'PROCESSING':
          refundStatus = 'PENDING'
          break
        default:
          refundStatus = 'FAILED'
      }

      return {
        channelRefundNo: (data.refund_id as string) || params.refundNo,
        status: refundStatus,
        message: status,
      }
    } catch (error) {
      this.logger.error(`微信退款调用异常: ${error}`)
      throw error
    }
  }

  /**
   * 查询退款状态
   */
  async queryRefund(
    channelRefundNo: string,
    channelConfig: ChannelConfig,
  ): Promise<RefundQueryResult> {
    const pay = this.buildPayClient(channelConfig)

    try {
      const result = await pay.find_refunds(channelRefundNo)

      if (result.status !== 200) {
        return {
          channelRefundNo,
          status: 'FAILED',
          message: '查询失败',
        }
      }

      const data = (result.data || {}) as Record<string, any>
      const status = data.status as string
      let refundStatus: RefundQueryResult['status']
      switch (status) {
        case 'SUCCESS':
          refundStatus = 'SUCCESS'
          break
        case 'PROCESSING':
          refundStatus = 'PENDING'
          break
        default:
          refundStatus = 'FAILED'
      }

      return {
        channelRefundNo,
        status: refundStatus,
        message: status,
      }
    } catch (error) {
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
    const apiV3Key = cfg.apiV3Key as string

    if (!apiV3Key) {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信支付 APIv3 密钥未配置'))
    }

    const pay = this.buildPayClient(cfg, true)

    let body: {
      resource: { ciphertext: string; nonce: string; associated_data: string }
      out_trade_no: string
    }
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信退款回调 body 非 JSON'))
    }

    let resource: {
      out_trade_no: string
      out_refund_no: string
      refund_id: string
      refund_status: string
      amount: { refund: number }
    }
    try {
      const decrypted = pay.decipher_gcm<unknown>(
        body.resource.ciphertext,
        body.resource.associated_data,
        body.resource.nonce,
        apiV3Key,
      )
      if (typeof decrypted !== 'object' || decrypted === null) {
        throw new Error('decrypt not json')
      }
      resource = decrypted as {
        out_trade_no: string
        out_refund_no: string
        refund_id: string
        refund_status: string
        amount: { refund: number }
      }
    } catch {
      throw new Error(kbError(KBErrorCodes.AUTHENTICATION_FAILED, '微信退款回调解密失败'))
    }

    const status = resource.refund_status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'

    return {
      channelRefundNo: resource.refund_id,
      orderNo: resource.out_trade_no,
      refundNo: resource.out_refund_no,
      amount: resource.amount?.refund || 0,
      status,
      signature: headers['wechatpay-signature'] || '',
    }
  }

  buildRefundCallbackSuccess(): string {
    return JSON.stringify({ code: 'SUCCESS', message: '成功' })
  }
}
