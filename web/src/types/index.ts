// KeBaiPay 商户后台 - API 类型定义（对齐后端契约）

export interface LoginResult {
  userId: string
  token: string
}

export interface MerchantInfo {
  id: string
  userId: string
  merchantNo: string
  merchantName: string
  merchantType: string
  contactName: string | null
  contactPhone: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'
  payRate: number
  withdrawRate: number
  dailyLimitYuan: string
  createdAt: string
}

export interface DashboardPeriod {
  count: number
  amountYuan: string
  feeYuan: string
  netYuan: string
}

export interface DashboardData {
  today: DashboardPeriod
  week: DashboardPeriod
  month: DashboardPeriod
}

export type OrderStatus = 'PENDING' | 'PAID' | 'CLOSED' | 'REFUNDED'

export interface PaymentOrder {
  id: string
  orderNo: string
  merchantOrderNo: string
  appId: string | null
  amount: number
  fee: number
  amountYuan: string
  feeYuan: string
  currency: string
  subject: string
  body: string | null
  status: OrderStatus
  payerId: string | null
  paidAt: string | null
  createdAt: string
  notifyStatus: 'PENDING' | 'SUCCESS' | 'FAILED'
  notifyCount: number
  callbackUrl?: string | null
  refundAmount: number
  settledAt: string | null
}

export interface Paged<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface ReconciliationDay {
  date: string
  count: number
  amountYuan: string
  feeYuan: string
  netYuan: string
}

export interface ReconciliationSummary {
  count: number
  amountYuan: string
  feeYuan: string
  netYuan: string
}

export interface ReconciliationData {
  data: ReconciliationDay[]
  summary: ReconciliationSummary
}

export interface MerchantQrCode {
  id: string
  code: string
  amount: number | null
  remark: string | null
  status: string
  createdAt: string
  payUrl?: string
}

export interface MerchantApp {
  id: string
  appId: string
  name: string
  callbackUrl: string | null
  status: string
  createdAt: string
}

export interface MerchantAppWithSecret extends MerchantApp {
  appSecret: string
}
