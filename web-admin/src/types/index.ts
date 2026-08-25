// KeBaiPay 管理后台 - API 类型定义

export interface AdminLoginResult {
  token: string
  adminId: string
}

export interface DashboardStats {
  totalUsers: number
  totalMerchants: number
  todayOrders: number
  pendingWithdrawals: number
  pendingMerchants: number
}

export interface Paged<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface AdminUser {
  id: string
  nickname: string
  phone: string | null
  email: string | null
  status: string
  realNameStatus: string
  createdAt: string
}

export interface AdminMerchant {
  id: string
  merchantNo: string
  merchantName: string
  merchantType: string
  contactName: string | null
  status: string
  payRate: number
  dailyLimitYuan: string
  createdAt: string
  user?: { nickname: string; phone: string | null; email: string | null }
}

export interface AdminWithdrawal {
  id: string
  orderNo: string
  amountYuan?: string
  status: string
  channelAccount: string | null
  createdAt: string
  user?: { nickname: string }
}

export interface PaymentOrder {
  id: string
  orderNo: string
  subject: string
  amountYuan: string
  status: string
  merchantOrderNo: string
  createdAt: string
}

export interface RiskEvent {
  id: string
  type: string
  level: string
  description?: string
  handled?: boolean
  handledBy?: string | null
  handledAt?: string | null
  userId: string | null
  createdAt: string
}

export interface FinanceOverview {
  totalTurnoverYuan?: string
  totalIncomeYuan?: string
  totalExpenseYuan?: string
  totalFeeYuan?: string
  netIncomeYuan?: string
  totalAssets?: string
  transactionCount?: number
  [key: string]: unknown
}
