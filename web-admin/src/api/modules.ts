import http, { extractError } from './http'
import type {
  AdminLoginResult,
  DashboardStats,
  Paged,
  AdminUser,
  AdminMerchant,
  AdminWithdrawal,
  PaymentOrder,
  RiskEvent,
  FinanceOverview,
} from '@/types'

// ---------- 认证 ----------
export async function adminLogin(body: { username: string; password: string }): Promise<AdminLoginResult> {
  const { data } = await http.post<AdminLoginResult>('/admin/auth/login', body)
  return data
}

// ---------- 概览 ----------
export async function fetchDashboard(): Promise<DashboardStats> {
  const { data } = await http.get<DashboardStats>('/admin/dashboard')
  return data
}

// ---------- 用户 ----------
export async function fetchUsers(params: { keyword?: string; status?: string; page?: number; limit?: number }): Promise<Paged<AdminUser>> {
  const { data } = await http.get<Paged<AdminUser>>('/admin/users', { params })
  return data
}

export async function setUserStatus(id: string, body: { status: string }): Promise<unknown> {
  const { data } = await http.post(`/admin/users/${id}/status`, body)
  return data
}

// ---------- 商户 ----------
export async function fetchMerchants(params: { status?: string; page?: number; limit?: number }): Promise<Paged<AdminMerchant>> {
  const { data } = await http.get<Paged<AdminMerchant>>('/admin/merchants', { params })
  return data
}

export async function auditMerchant(id: string, body: { action: 'APPROVE' | 'REJECT'; reason?: string }): Promise<unknown> {
  const { data } = await http.post(`/admin/merchants/${id}/audit`, body)
  return data
}

// ---------- 提现 ----------
export async function fetchWithdrawals(params: { status?: string; page?: number; limit?: number }): Promise<Paged<AdminWithdrawal>> {
  const { data } = await http.get<Paged<AdminWithdrawal>>('/admin/withdrawals', { params })
  return data
}

export async function approveWithdrawal(id: string): Promise<unknown> {
  const { data } = await http.post(`/admin/withdrawals/${id}/approve`)
  return data
}

export async function rejectWithdrawal(id: string, reason: string): Promise<unknown> {
  const { data } = await http.post(`/admin/withdrawals/${id}/reject`, { reason })
  return data
}

// ---------- 订单 ----------
export async function fetchOrders(params: { status?: string; page?: number; limit?: number }): Promise<Paged<PaymentOrder>> {
  const { data } = await http.get<Paged<PaymentOrder>>('/admin/payment-orders', { params })
  return data
}

// ---------- 风控事件 ----------
export async function fetchRiskEvents(params: { level?: string; handled?: string; page?: number; limit?: number }): Promise<Paged<RiskEvent>> {
  const { data } = await http.get<Paged<RiskEvent>>('/admin/risk-events', { params })
  return data
}

export async function handleRiskEvent(id: string, body: { note?: string }): Promise<unknown> {
  const { data } = await http.post(`/admin/risk-events/${id}/handle`, body)
  return data
}

// ---------- 财务 ----------
export async function fetchFinanceOverview(): Promise<FinanceOverview> {
  const { data } = await http.get<FinanceOverview>('/admin/finance/overview')
  return data
}

// ---------- 智能体管理 ----------
export interface AgentItem {
  id: string
  agentNo: string
  name: string
  description: string | null
  status: 'ACTIVE' | 'DISABLED'
  scenario: string
  scopes: string
  version: string
  createdAt: string
}

export async function fetchAgents(): Promise<AgentItem[]> {
  const { data } = await http.get<AgentItem[]>('/agent/admin/agents')
  return data
}

export async function createAgent(body: {
  name: string
  scenario: string
  description?: string
  scopes: string[]
}): Promise<AgentItem> {
  const { data } = await http.post<AgentItem>('/agent/admin/agents', body)
  return data
}

export async function updateAgent(
  id: string,
  body: { name?: string; description?: string; status?: string; scopes?: string[] },
): Promise<AgentItem> {
  const { data } = await http.patch<AgentItem>(`/agent/admin/agents/${id}`, body)
  return data
}

export { extractError }

// ---------- 实名审核（P1-2） ----------
export interface PendingIdentity {
  id: string
  realName: string
  idCardMasked?: string
  status: string
  createdAt: string
  user?: { id: string; nickname?: string; phone?: string; email?: string }
}

export async function fetchPendingIdentities(params: { page?: number; limit?: number }): Promise<Paged<PendingIdentity>> {
  const { data } = await http.get<Paged<PendingIdentity>>('/admin/identity/pending', { params })
  return data
}

export async function approveIdentity(id: string): Promise<unknown> {
  const { data } = await http.post(`/admin/identity/${id}/approve`)
  return data
}

export async function rejectIdentity(id: string, body: { reason: string }): Promise<unknown> {
  const { data } = await http.post(`/admin/identity/${id}/reject`, body)
  return data
}

// ---------- 渠道配置中心（P1-3） ----------
export interface ChannelConfigRow {
  id?: string
  code: string
  name: string
  type: string
  enabled: boolean
  priority: number
  config: string
}

export async function fetchChannels(): Promise<ChannelConfigRow[]> {
  const { data } = await http.get<ChannelConfigRow[]>('/admin/channels')
  return data
}

export async function createChannel(body: Omit<ChannelConfigRow, 'id'>): Promise<unknown> {
  const { data } = await http.post('/admin/channels', body)
  return data
}

export async function updateChannel(code: string, body: Partial<Omit<ChannelConfigRow, 'id' | 'code'>>): Promise<unknown> {
  const { data } = await http.put(`/admin/channels/${code}`, body)
  return data
}

export async function deleteChannel(code: string): Promise<unknown> {
  const { data } = await http.delete(`/admin/channels/${code}`)
  return data
}

export async function testChannel(code: string): Promise<{ available: boolean; message: string }> {
  const { data } = await http.post(`/admin/channels/${code}/test`)
  return data
}
