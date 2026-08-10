// KeBaiPay 用户端 H5 - API 类型定义

export interface LoginResult {
  userId: string
  token: string
}

export interface AccountInfo {
  id: string
  userId: string
  availableBalanceYuan: string
  frozenBalanceYuan: string
  totalBalanceYuan: string
  status: string
  ledgers?: LedgerItem[]
}

export interface LedgerItem {
  id: string
  type: string
  direction: 'INCOME' | 'EXPENSE'
  amountYuan: string
  balanceAfterYuan: string
  counterparty?: string
  remark?: string
  createdAt: string
}

export interface RechargeResult {
  orderNo: string
  amountYuan?: string
  status: string
  [key: string]: unknown
}

export interface Paged<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface BillItem {
  id: string
  type: string
  direction: 'INCOME' | 'EXPENSE'
  amountYuan: string
  counterparty: string | null
  remark: string | null
  createdAt: string
}

export interface RedPacket {
  id: string
  packetNo: string
  type: string
  amount: number
  amountYuan?: string
  totalCount: number
  receivedCount: number
  status: string
  remark: string | null
  createdAt: string
}

export interface CashierOrder {
  id: string
  orderNo: string
  amount: number
  amountYuan: string
  subject: string
  status: string
  merchantOrderNo: string
  createdAt: string
}
