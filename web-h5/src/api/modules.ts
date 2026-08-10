import http, { extractError } from './http'
import type {
  LoginResult,
  AccountInfo,
  RechargeResult,
  Paged,
  BillItem,
  RedPacket,
  CashierOrder,
} from '@/types'

// ---------- 认证 ----------
export async function login(body: { phone?: string; email?: string; password: string }): Promise<LoginResult> {
  const { data } = await http.post<LoginResult>('/auth/login', body)
  return data
}

// ---------- 账户 ----------
export async function fetchAccount(): Promise<AccountInfo | null> {
  const { data } = await http.get<AccountInfo | null>('/accounts/me')
  return data
}

// ---------- 充值 ----------
export async function recharge(body: {
  amount: number
  payPassword: string
  idempotencyKey?: string
}): Promise<RechargeResult> {
  const { data } = await http.post<RechargeResult>('/transactions/recharge', body)
  return data
}

// ---------- 转账 ----------
export async function transfer(body: {
  toUserId: string
  amount: number
  payPassword: string
  remark?: string
  idempotencyKey?: string
}): Promise<unknown> {
  const { data } = await http.post('/transfers', body)
  return data
}

// ---------- 提现 ----------
export async function withdraw(body: {
  amount: number
  payPassword: string
  channelAccount?: string
  remark?: string
  idempotencyKey?: string
}): Promise<unknown> {
  const { data } = await http.post('/withdrawals', body)
  return data
}

export async function fetchWithdrawals(): Promise<Paged<unknown>> {
  const { data } = await http.get<Paged<unknown>>('/withdrawals')
  return data
}

// ---------- 账单 ----------
export async function fetchBills(params?: { direction?: 'INCOME' | 'EXPENSE' }): Promise<BillItem[]> {
  const { data } = await http.get<BillItem[]>('/bills', { params })
  return data
}

// ---------- 红包 ----------
export async function sendRedPacket(body: {
  amount: number
  payPassword: string
  remark?: string
  type?: string
  totalCount?: number
  perAmount?: number
  password?: string
  idempotencyKey?: string
}): Promise<RedPacket> {
  const { data } = await http.post<RedPacket>('/red-packets', body)
  return data
}

export async function receiveRedPacket(packetNo: string, body?: { password?: string }): Promise<unknown> {
  const { data } = await http.post(`/red-packets/${packetNo}/receive`, body || {})
  return data
}

export async function fetchSentRedPackets(): Promise<RedPacket[]> {
  const { data } = await http.get<RedPacket[]>('/red-packets/sent')
  return data
}

// ---------- 收银台 ----------
export async function createCashierOrder(body: {
  merchantOrderNo: string
  amount: number
  subject: string
  callbackUrl?: string
}): Promise<CashierOrder> {
  const { data } = await http.post<CashierOrder>('/cashier/orders', body)
  return data
}

export async function fetchCashierOrders(params?: Record<string, unknown>): Promise<Paged<CashierOrder>> {
  const { data } = await http.get<Paged<CashierOrder>>('/cashier/orders', { params })
  return data
}

export async function payCashierOrder(orderNo: string, payPassword: string): Promise<unknown> {
  const { data } = await http.post(`/cashier/orders/${orderNo}/pay`, { payPassword })
  return data
}

export { extractError }
