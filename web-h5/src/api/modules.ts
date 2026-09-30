import http from './http'
import type {
  LoginResult,
  Paged,
  BillItem,
  CashierOrder,
} from '@/types'

// ---------- 认证 ----------
export async function login(body: { phone?: string; email?: string; password: string }): Promise<LoginResult> {
  const { data } = await http.post<LoginResult>('/auth/login', body)
  return data
}

// ---------- 账单 ----------
export async function fetchBills(params?: { direction?: 'INCOME' | 'EXPENSE' }): Promise<BillItem[]> {
  const { data } = await http.get<BillItem[]>('/bills', { params })
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

/** 渠道收单支付（合规聚合模式：替代原余额支付） */
export async function payCashierOrder(orderNo: string, body: { channel: string; payMethod?: string; clientIp?: string }): Promise<unknown> {
  const { data } = await http.post(`/cashier/orders/${orderNo}/channel-pay`, body)
  return data
}

/** 扫码收款信息（无需登录）：GET /cashier/qrcode/:code 返回商户与收款信息 */
export async function fetchQrCodeInfo(code: string): Promise<{
  merchantNo: string
  merchantName: string
  amountYuan: string | null
  remark: string
  subject: string
}> {
  const { data } = await http.get(`/cashier/qrcode/${code}`)
  return data
}

// ---------- AI 智能体（用户侧授权/登录，用用户 token） ----------
export interface MyAgent {
  id: string
  agentNo: string
  name: string
  description: string | null
  scenario: string
  scopes: string[]
  authorization: { id: string; scopes: string[] } | null
}

export async function listMyAgents(): Promise<MyAgent[]> {
  const { data } = await http.get<MyAgent[]>('/agent/me/agents')
  return data
}

export async function authorizeAgent(agentId: string, scopes: string[]): Promise<{ id: string }> {
  const { data } = await http.post<{ id: string }>('/agent/authorize', { agentId, scopes })
  return data
}

export async function agentLogin(agentId: string, authId: string): Promise<{ token: string }> {
  const { data } = await http.post<{ token: string }>('/agent/login', { agentId, authId })
  return data
}
