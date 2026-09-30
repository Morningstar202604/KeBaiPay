// KeBaiPay 用户端 H5 - API 类型定义

export interface LoginResult {
  userId: string
  token: string
}

export interface Paged<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export interface BillItem {
  id: string
  orderNo: string
  subject: string
  status: string
  amount: number
  amountYuan: string
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
