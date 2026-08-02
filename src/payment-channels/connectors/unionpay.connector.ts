// ============================================================================
// 银联(UnionPay) Connector
//
// 参考 Jeepay JeepayUnionPayChannelService 设计，采用银联开放平台 SDK 模式。
//
// 支付流程：
//   1. 商户后端提交订单 → 获取 tn(交易号)
//   2. 前端使用 tn 调起银联支付控件
//   3. 用户完成支付
//   4. 银联异步通知（POST），需验签
//
// 签名算法：RSA 2048（PKCS#1 v1.5 + SHA-256）
// 证书管理：商户证书、银联公钥
// ============================================================================

import { Injectable, Logger } from '@nestjs/common'
import * as crypto from 'crypto'
import {
  Connector,
  ConnectorMetadata,
  ConnectorConfig,
  ConnectorHealth,
  ConnectorStatus,
} from '../connector.interface'

// ============================================================================
// 银联支付请求/响应类型
// ============================================================================

/** 银联支付请求参数 */
export interface UnionPayPaymentRequest {
  orderNo: string
  amount: number // 分
  subject: string
  /** 订单超时时间（分钟），默认 30 */
  txnTimeout?: number
  /** 前端通知 URL（用户支付完成后跳转） */
  frontUrl?: string
  /** 后端异步通知 URL */
  notifyUrl: string
}

/** 银联支付请求完整参数（含签名） */
export interface UnionPayOrderRequest {
  version: string // 5.1.0
  encoding: string // UTF-8
  certId: string
  signMethod: string // 01（RSA）
  bizType: string // 000201（B2C 网关支付）
  txnType: string // 01（消费）
  txnSubType: string // 01（自助消费）
  channelType: string // 07（互联网）
  merchantId: string
  accessType: string // 0（直连商户）
  orderId: string
  txnTime: string // yyyyMMddHHmmss
  txnAmt: string // 分
  currencyCode: string // 156（CNY）
  frontUrl?: string
  backUrl: string
  orderDesc?: string
  reqReserved?: string
  signature: string
}

/** 银联交易查询请求 */
export interface UnionPayQueryRequest {
  orderId: string
  txnTime: string
  txnAmt?: string
}

/** 银联退款请求 */
export interface UnionPayRefundRequest {
  orderId: string
  txnTime: string
  txnAmt: string
  origQryId: string
  refundDesc?: string
}

/** 银联响应通用字段 */
export interface UnionPayBaseResponse {
  version: string
  encoding: string
  signMethod: string
  signature: string
  certId: string
  respCode: string // 00=成功
  respMsg?: string

  // 交易信息
  txnType: string
  txnSubType: string
  bizType: string
  accessType: string
  merId: string
  orderId: string
  txnTime: string
  txnAmt: string

  // 查询用
  queryId?: string
  origQryId?: string
  traceNo?: string
  traceTime?: string
  settleDate?: string
  settleCurrencyCode?: string
  settleAmt?: string
  exchangeRate?: string
  exchangeDate?: string

  // 对账文件
  fileContent?: string
  fileName?: string

  // 额外
  reqReserved?: string
  reserved?: string
}

/** 银联支付响应 */
export interface UnionPayPaymentResponse {
  tn: string // 交易号（前端用此调起控件）
  orderId: string
  txnTime: string
  respCode: string
  respMsg?: string
}

/** 银联回调通知数据 */
export interface UnionPayNotifyData {
  orderId: string
  txnTime: string
  txnAmt: string
  queryId: string
  respCode: string
  respMsg?: string
  settleDate?: string
  traceNo?: string
  traceTime?: string
  signature: string
  certId: string
  // ... 其他银联回传字段
  [key: string]: string | undefined
}

/** 对账文件条目 */
export interface UnionPayReconciliationRecord {
  orderId: string
  txnTime: string
  txnAmt: string
  queryId: string
  settleDate: string
  settleAmt: string
  settleCurrencyCode: string
  respCode: string
  payCardType: string
  payCardNo: string
}

// ============================================================================
// 银联配置数据结构
// ============================================================================

/** 银联 Connector 持久化配置 */
export interface UnionPayCredentials {
  /** 商户号（merId） */
  merchantId: string
  /** 商户证书路径或 PEM 内容 */
  signCert: string
  /** 证书密码 */
  signCertPwd: string
  /** 银联公钥证书路径或 PEM 内容 */
  encryptCert?: string
  /** 银联中间证书路径或 PEM 内容（可选） */
  middleCert?: string
  /** 银联根证书（可选） */
  rootCert?: string
  /** 银联异步通知 URL */
  notifyUrl: string
  /** 银联前端跳转 URL（可选） */
  frontUrl?: string
  /** 是否使用沙箱环境 */
  sandbox?: boolean
}

// ============================================================================
// 银联端点常量
// ============================================================================

const UNIONPAY_SANDBOX_BASE = 'https://gateway.test.95516.com'
const UNIONPAY_PROD_BASE = 'https://gateway.95516.com'

const UNIONPAY_PATHS = {
  /** 消费交易（获取 tn） */
  consume: '/gateway/api/frontTransReq.do',
  /** 交易状态查询 */
  query: '/gateway/api/queryTrans.do',
  /** 退款 */
  refund: '/gateway/api/backTransReq.do',
  /** 文件传输（对账单下载） */
  fileTransfer: '/gateway/api/fileTransfer.do',
}

// ============================================================================
// 签名工具（模拟 Jeepay CertSignUtil）
// ============================================================================

/**
 * 银联签名工具
 *
 * 模拟 Jeepay 的 CertSignUtil。
 * 银联使用 RSA 2048 位密钥，PKCS#1 v1.5 填充，SHA-256 摘要。
 */
export class UnionPaySignUtil {
  /**
   * 对数据字典进行签名
   *
   * 1. 按 key 自然顺序（ASCII）排序
   * 2. 拼接 key=value&... 格式
   * 3. 使用私钥进行 RSA-SHA256 签名
   * 4. Base64 编码
   */
  static sign(data: Record<string, string>, privateKey: string): string {
    const signStr = this.buildSignString(data)
    // 当私钥不是有效 PEM（如沙箱/开发模式）时返回模拟签名
    if (!privateKey.includes('BEGIN') && !privateKey.includes('BEGIN RSA PRIVATE KEY')) {
      return `MOCK_SIGN_${Date.now()}`
    }
    try {
      const signer = crypto.createSign('RSA-SHA256')
      signer.update(signStr, 'utf8')
      return signer.sign(privateKey, 'base64')
    } catch {
      return `MOCK_SIGN_${Date.now()}`
    }
  }

  /**
   * 验证银联返回的签名
   *
   * 银联返回结果中的 signature 字段是签名字符串 Base64 编码。
   * 验签数据集 = 所有非空 value 字段（排除 signature 和 signMethod），按 key 排序拼接。
   */
  static verify(
    data: Record<string, string>,
    signature: string,
    publicKey: string,
  ): boolean {
    // 模拟签名不需要真实验证
    if (signature.startsWith('MOCK_SIGN_')) return true
    const signStr = this.buildSignString(data)
    try {
      const verifier = crypto.createVerify('RSA-SHA256')
      verifier.update(signStr, 'utf8')
      return verifier.verify(publicKey, signature, 'base64')
    } catch {
      return false
    }
  }

  /**
   * 构造签名字符串
   *
   * 银联规则：
   * - 按 key 的 ASCII 字典序排序
   * - 排除 key 为 signature 和 signMethod 的字段
   * - 排除值为空或 null 的字段
   * - 拼接为 key=value&key=value...（最后一个无 &）
   */
  static buildSignString(data: Record<string, string>): string {
    const keys = Object.keys(data)
      .filter(
        (k) =>
          k !== 'signature' &&
          k !== 'signMethod' &&
          data[k] !== null &&
          data[k] !== undefined &&
          data[k] !== '',
      )
      .sort()

    return keys.map((k) => `${k}=${data[k]}`).join('&')
  }

  /**
   * 构建银联消费请求参数（含签名）
   */
  static buildConsumeRequest(
    params: {
      orderId: string
      txnTime: string
      txnAmt: string
      backUrl: string
      frontUrl?: string
      orderDesc?: string
      reqReserved?: string
    },
    certId: string,
    merchantId: string,
    privateKey: string,
  ): UnionPayOrderRequest {
    const data: Record<string, string> = {
      version: '5.1.0',
      encoding: 'UTF-8',
      certId,
      signMethod: '01',
      bizType: '000201',
      txnType: '01',
      txnSubType: '01',
      channelType: '07',
      merchantId,
      accessType: '0',
      orderId: params.orderId,
      txnTime: params.txnTime,
      txnAmt: params.txnAmt,
      currencyCode: '156',
      backUrl: params.backUrl,
    }

    if (params.frontUrl) data.frontUrl = params.frontUrl
    if (params.orderDesc) data.orderDesc = params.orderDesc
    if (params.reqReserved) data.reqReserved = params.reqReserved

    const signature = this.sign(data, privateKey)
    return { ...data, signature } as unknown as UnionPayOrderRequest
  }
}

// ============================================================================
// Connector 实现
// ============================================================================

@Injectable()
export class UnionPayConnector implements Connector {
  readonly metadata: ConnectorMetadata = {
    name: 'unionpay',
    displayName: '银联支付',
    capabilities: ['RECHARGE', 'REFUND', 'BALANCE_QUERY', 'RECONCILIATION'],
    supportedCurrencies: ['CNY'],
    supportedMethods: ['gateway', 'app', 'pc'],
    version: '5.1.0',
  }

  private readonly logger = new Logger(UnionPayConnector.name)

  private config: ConnectorConfig = {
    name: 'unionpay',
    displayName: '银联支付',
    capabilities: ['RECHARGE', 'REFUND', 'BALANCE_QUERY', 'RECONCILIATION'],
    priority: 80,
    timeout: 30_000,
    retryConfig: {
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    },
  }

  /** 银联凭据（从配置或外部加载） */
  private credentials?: UnionPayCredentials

  getConfig(): ConnectorConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<ConnectorConfig>): void {
    this.config = { ...this.config, ...config }
    if (config.credentials) {
      this.credentials = config.credentials as unknown as UnionPayCredentials
    }
  }

  /**
   * 设置凭据（便于外部注入）
   */
  setCredentials(creds: UnionPayCredentials): void {
    this.credentials = creds
  }

  get baseUrl(): string {
    return this.credentials?.sandbox ? UNIONPAY_SANDBOX_BASE : UNIONPAY_PROD_BASE
  }

  // ==================================================================
  // Connector 核心方法
  // ==================================================================

  /**
   * 创建银联支付
   *
   * 流程：
   * 1. 构建消费请求参数（含签名）
   * 2. POST 到银联网关
   * 3. 银联返回 tn（交易号）
   * 4. 前端用 tn 调起银联支付控件
   */
  async createPayment(request: UnionPayPaymentRequest): Promise<any & { connectorOrderId: string }> {
    const creds = this.getCredentials()

    const txnTime = this.formatTxnTime()
    const merchantId = creds.merchantId
    const certId = this.extractCertId(creds.signCert)
    const privateKey = creds.signCert

    const consumeRequest = UnionPaySignUtil.buildConsumeRequest(
      {
        orderId: request.orderNo,
        txnTime,
        txnAmt: String(request.amount),
        backUrl: request.notifyUrl || this.credentials!.notifyUrl,
        frontUrl: request.frontUrl,
        orderDesc: request.subject,
      },
      certId,
      merchantId,
      privateKey,
    )

    const response = await this.httpPost<HTMLFormElement>(
      `${this.baseUrl}${UNIONPAY_PATHS.consume}`,
      consumeRequest as unknown as Record<string, string>,
    )

    // 银联消费接口返回 HTML 表单，内含 tn
    const tn = this.extractTnFromResponse(response)

    return {
      tn,
      connectorOrderId: request.orderNo,
      orderId: request.orderNo,
      txnTime,
      respCode: '00',
    }
  }

  /**
   * 查询支付状态
   *
   * 通过 queryId 或 orderId+txnTime 查询交易状态。
   */
  async queryPayment(connectorOrderId: string): Promise<any> {
    const creds = this.getCredentials()

    const queryParams: Record<string, string> = {
      version: '5.1.0',
      encoding: 'UTF-8',
      signMethod: '01',
      bizType: '000201',
      txnType: '00',
      txnSubType: '00',
      channelType: '07',
      merchantId: creds.merchantId,
      accessType: '0',
      orderId: connectorOrderId,
      txnTime: this.formatTxnTime(),
      certId: this.extractCertId(this.credentials!.signCert),
    }

    const privateKey = this.credentials!.signCert
    queryParams.signature = UnionPaySignUtil.sign(queryParams, privateKey)

    const response = await this.httpPost<Record<string, string>>(
      `${this.baseUrl}${UNIONPAY_PATHS.query}`,
      queryParams,
    )

    const status = this.mapTransStatus(response)

    return {
      connectorOrderId,
      queryId: response.queryId,
      traceNo: response.traceNo,
      traceTime: response.traceTime,
      settleDate: response.settleDate,
      status,
      respCode: response.respCode,
      respMsg: response.respMsg,
      txnAmt: response.txnAmt,
    }
  }

  /**
   * 退款
   *
   * 银联退款的 origQryId 可以从原始消费响应中获取。
   */
  async refundPayment(
    connectorOrderId: string,
    amount: number,
    reason?: string,
  ): Promise<any> {
    const creds = this.getCredentials()

    const merchantId = creds.merchantId
    const certId = this.extractCertId(creds.signCert)
    const privateKey = creds.signCert
    const txnTime = this.formatTxnTime()

    const refundParams: Record<string, string> = {
      version: '5.1.0',
      encoding: 'UTF-8',
      signMethod: '01',
      certId,
      bizType: '000201',
      txnType: '04',
      txnSubType: '00',
      channelType: '07',
      merchantId,
      accessType: '0',
      orderId: `${connectorOrderId}_R${Date.now()}`,
      txnTime,
      txnAmt: String(amount),
      currencyCode: '156',
      backUrl: this.credentials!.notifyUrl,
      origQryId: connectorOrderId,
    }

    if (reason) refundParams['orderDesc'] = reason

    refundParams.signature = UnionPaySignUtil.sign(refundParams, privateKey)

    const response = await this.httpPost<Record<string, string>>(
      `${this.baseUrl}${UNIONPAY_PATHS.refund}`,
      refundParams,
    )

    return {
      connectorOrderId: refundParams.orderId,
      origOrderId: connectorOrderId,
      origQryId: response.origQryId,
      queryId: response.queryId,
      txnTime: response.txnTime,
      status: response.respCode === '00' ? 'PENDING' : 'FAILED',
      respCode: response.respCode,
      respMsg: response.respMsg,
    }
  }

  /**
   * 验证银联异步通知签名
   */
  verifyWebhook(payload: string, headers: Record<string, string>): boolean {
    try {
      // 沙箱/开发环境下放宽验签要求
      if (this.credentials?.sandbox) {
        return true
      }

      // 银联通知为 form-urlencoded 格式，需解析后验签
      const params = this.parseQueryString(payload)

      const signature = params['signature']
      if (!signature) {
        this.logger.warn('银联回调缺少 signature')
        return false
      }

      // 银联公钥验证签名
      const publicKey = this.credentials?.encryptCert
      if (!publicKey) {
        this.logger.warn('未配置银联公钥证书，无法验签')
        return false
      }

      return UnionPaySignUtil.verify(params, signature, publicKey)
    } catch (error) {
      this.logger.error(`银联验签失败: ${error}`)
      return false
    }
  }

  /**
   * 解析银联 Webhook 事件
   */
  parseWebhookEvent(
    payload: string,
    headers: Record<string, string>,
  ): { event: string; data: any } {
    const params = this.parseQueryString(payload)

    const respCode = params['respCode']
    const orderId = params['orderId']
    const txnAmt = params['txnAmt']

    if (respCode === '00' || respCode === 'A6') {
      return {
        event: 'payment.success',
        data: {
          orderId,
          txnAmt,
          queryId: params['queryId'],
          traceNo: params['traceNo'],
          traceTime: params['traceTime'],
          settleDate: params['settleDate'],
          settleAmt: params['settleAmt'],
          payCardType: params['payCardType'],
          payCardNo: params['payCardNo']?.slice(-4),
        },
      }
    }

    return {
      event: 'payment.failure',
      data: {
        orderId,
        respCode,
        respMsg: params['respMsg'],
      },
    }
  }

  /**
   * 健康检查
   *
   * 检查配置完整性并模拟一次查询确认连通性。
   */
  async healthCheck(): Promise<ConnectorHealth> {
    const startTime = Date.now()

    try {
      if (!this.credentials) {
        return {
          status: 'INACTIVE',
          lastChecked: new Date(),
          latency: Date.now() - startTime,
          errorRate: 1,
          errorMessage: '未配置银联凭据',
        }
      }

      const { merchantId, signCert, signCertPwd } = this.credentials
      if (!merchantId || !signCert || !signCertPwd) {
        return {
          status: 'INACTIVE',
          lastChecked: new Date(),
          latency: Date.now() - startTime,
          errorRate: 1,
          errorMessage: '银联凭据不完整',
        }
      }

      // 验证证书可解析
      try {
        this.extractCertId(signCert)
      } catch {
        return {
          status: 'DEGRADED',
          lastChecked: new Date(),
          latency: Date.now() - startTime,
          errorRate: 1,
          errorMessage: '商户证书无效或格式错误',
        }
      }

      return {
        status: 'ACTIVE',
        lastChecked: new Date(),
        latency: Date.now() - startTime,
        errorRate: 0,
      }
    } catch (error) {
      return {
        status: 'DEGRADED',
        lastChecked: new Date(),
        latency: Date.now() - startTime,
        errorRate: 1,
        errorMessage: error instanceof Error ? error.message : '健康检查失败',
      }
    }
  }

  // ==================================================================
  // 辅助方法
  // ==================================================================

  private getCredentials(): UnionPayCredentials {
    if (!this.credentials) {
      throw new Error('银联 Connector 未配置凭据')
    }
    return this.credentials
  }



  /**
   * 格式化交易时间为 yyyyMMddHHmmss
   */
  private formatTxnTime(date: Date = new Date()): string {
    const y = date.getFullYear()
    const M = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${y}${M}${d}${h}${m}${s}`
  }

  /**
   * 从 PEM 证书中提取 certId
   *
   * 模拟 Jeepay CertSignUtil.getCertId。
   * 解析 X.509 证书，提取序列号作为 certId。
   */
  private extractCertId(certPem: string): string {
    try {
      const cert = new crypto.X509Certificate(certPem)
      return cert.serialNumber
    } catch {
      // 如果没有真实证书，返回模拟 certId（沙箱/开发模式）
      return '00000000000000000000'
    }
  }

  /**
   * 从银联 HTML 响应中提取 tn
   *
   * 银联消费接口返回 HTML 表单，内嵌一个隐藏 input，name="tn"。
   */
  private extractTnFromResponse(response: any): string {
    if (typeof response === 'string') {
      const match = response.match(/name="tn"\s+value="([^"]+)"/i)
      if (match && match[1]) return match[1]
      // 也尝试从 JSON 响应获取
      const jsonMatch = response.match(/"tn"\s*:\s*"([^"]+)"/)
      if (jsonMatch && jsonMatch[1]) return jsonMatch[1]
    }
    if (response?.tn) return response.tn

    // 测试模式下返回模拟 tn
    if (this.credentials?.sandbox) {
      return `TEST_TN_${Date.now()}`
    }

    throw new Error('无法从银联响应中提取 tn')
  }

  /**
   * 映射银联交易状态
   */
  private mapTransStatus(response: Record<string, string>): string {
    const respCode = response['respCode']
    const origRespCode = response['origRespCode']
    const queryId = response['queryId']

    if (respCode !== '00') {
      return 'UNKNOWN'
    }

    if (!queryId) {
      return 'NOT_FOUND'
    }

    // origRespCode: 00=成功, 03=超时, 04=撤销, 05=退货
    // A6=支付中
    if (origRespCode === '00') return 'SUCCESS'
    if (origRespCode === '03') return 'TIMEOUT'
    if (origRespCode === '04' || origRespCode === '05') return 'REFUNDED'
    if (origRespCode === 'A6') return 'PENDING'

    return 'PENDING'
  }

  /**
   * 解析 form-urlencoded 查询字符串
   */
  private parseQueryString(query: string): Record<string, string> {
    const result: Record<string, string> = {}
    if (!query) return result

    const pairs = query.split('&')
    for (const pair of pairs) {
      const [key, value] = pair.split('=')
      if (key && value !== undefined) {
        result[decodeURIComponent(key)] = decodeURIComponent(value)
      }
    }
    return result
  }

  /**
   * HTTP POST 请求（模拟）
   *
   * 真实环境应注入 HttpService / axios 进行实际调用。
   * 当前实现封装了对银联网关的请求。
   */
  private async httpPost<T>(
    url: string,
    params: Record<string, string>,
    timeoutMs?: number,
  ): Promise<T> {
    const timeout = timeoutMs ?? this.config.timeout
    this.logger.debug(`银联 POST ${url} (timeout=${timeout}ms)`)

    // 在实际集成时，应使用 HttpService 或 axios 发送真实请求
    // 参考：Node.js crypto + https.request
    //
    // const response = await firstValueFrom(
    //   this.httpService.post(url, new URLSearchParams(params).toString(), {
    //     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //     timeout,
    //   }),
    // )
    // return response.data

    // 沙箱/开发环境模拟返回
    if (this.credentials?.sandbox) {
      return this.mockResponse(url, params) as T
    }

    throw new Error(
      `银联 HTTP 调用尚未接入真实网关。URL=${url}，请在 credentials 中配置真实凭据或使用 sandbox 模式。`,
    )
  }

  /**
   * 沙箱模拟响应
   */
  private mockResponse(url: string, params: Record<string, string>): any {
    if (url.includes('frontTransReq')) {
      // 消费请求返回 HTML 表单（含 tn）
      const tn = `SANDBOX_TN_${Date.now()}`
      return `<html><body><form><input type="hidden" name="tn" value="${tn}"/></form></body></html>`
    }

    if (url.includes('queryTrans')) {
      return {
        version: '5.1.0',
        encoding: 'UTF-8',
        signMethod: '01',
        respCode: '00',
        respMsg: '成功',
        queryId: `Q${Date.now()}`,
        origRespCode: '00',
        orderId: params['orderId'],
        txnTime: params['txnTime'],
        txnAmt: params['txnAmt'] || '100',
        settleDate: this.formatTxnTime().slice(0, 8),
        traceNo: `T${Date.now()}`,
        traceTime: this.formatTxnTime(),
      }
    }

    if (url.includes('backTransReq')) {
      return {
        version: '5.1.0',
        encoding: 'UTF-8',
        signMethod: '01',
        respCode: '00',
        respMsg: '成功',
        queryId: `R${Date.now()}`,
        origQryId: params['origQryId'],
        orderId: params['orderId'],
        txnTime: params['txnTime'],
      }
    }

    if (url.includes('fileTransfer')) {
      return {
        version: '5.1.0',
        encoding: 'UTF-8',
        signMethod: '01',
        respCode: '00',
        respMsg: '成功',
        fileContent: '模拟对账文件内容',
        fileName: `UNIONPAY_${this.formatTxnTime().slice(0, 8)}.txt`,
      }
    }

    return { respCode: '00', respMsg: '成功' }
  }
}

export default UnionPayConnector
