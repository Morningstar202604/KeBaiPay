import http, { extractError } from './http'
import type {
  LoginResult,
  MerchantInfo,
  DashboardData,
  Paged,
  PaymentOrder,
  OrderStatus,
  ReconciliationData,
  MerchantQrCode,
  MerchantApp,
  MerchantAppWithSecret,
} from '@/types'

// ---------- 认证 ----------
export async function login(body: {
  phone?: string
  email?: string
  password: string
}): Promise<LoginResult> {
  const { data } = await http.post<LoginResult>('/auth/login', body)
  return data
}

// ---------- 商户 ----------
export async function registerMerchant(body: {
  merchantName: string
  merchantType?: 'PERSONAL' | 'ENTERPRISE'
  contactName?: string
  contactPhone?: string
  settleAccount?: string
  businessLicenseNo?: string
}): Promise<MerchantInfo> {
  const { data } = await http.post<MerchantInfo>('/merchants/register', body)
  return data
}

export async function fetchMerchantInfo(): Promise<MerchantInfo> {
  const { data } = await http.get<MerchantInfo>('/merchants/me')
  return data
}

export async function updateMerchantInfo(
  body: Partial<{ merchantName: string; contactName: string; contactPhone: string }>,
): Promise<MerchantInfo> {
  const { data } = await http.patch<MerchantInfo>('/merchants/me', body)
  return data
}

export async function fetchDashboard(): Promise<DashboardData> {
  const { data } = await http.get<DashboardData>('/merchants/dashboard')
  return data
}

// ---------- 订单 ----------
export interface OrderQuery {
  status?: OrderStatus
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

export async function fetchOrders(query: OrderQuery): Promise<Paged<PaymentOrder>> {
  const { data } = await http.get<Paged<PaymentOrder>>('/cashier/orders', { params: query })
  return data
}

// 手动重试订单回调通知
export async function retryOrderNotify(orderNo: string): Promise<unknown> {
  const { data } = await http.post(`/cashier/orders/${orderNo}/notify`)
  return data
}

// ---------- 对账 ----------
export async function fetchReconciliation(body: {
  startDate?: string
  endDate?: string
}): Promise<ReconciliationData> {
  const { data } = await http.get<ReconciliationData>('/cashier/orders/reconciliation', {
    params: body,
  })
  return data
}

// ---------- 收款码 ----------
export async function fetchQrCodes(): Promise<MerchantQrCode[]> {
  const { data } = await http.get<MerchantQrCode[]>('/merchants/qrcodes')
  return data
}

export async function createQrCode(body: {
  amount?: number
  remark?: string
}): Promise<MerchantQrCode> {
  const { data } = await http.post<MerchantQrCode>('/merchants/qrcodes', body)
  return data
}

export async function deleteQrCode(id: string): Promise<void> {
  await http.delete(`/merchants/qrcodes/${id}`)
}

// ---------- 应用 ----------
export async function fetchApps(): Promise<MerchantApp[]> {
  const { data } = await http.get<MerchantApp[]>('/merchants/apps')
  return data
}

export async function createApp(body: { name: string; callbackUrl?: string }): Promise<MerchantAppWithSecret> {
  const { data } = await http.post<MerchantAppWithSecret>('/merchants/apps', body)
  return data
}

export async function updateApp(
  appId: string,
  body: { name?: string; callbackUrl?: string },
): Promise<MerchantApp> {
  const { data } = await http.patch<MerchantApp>(`/merchants/apps/${appId}`, body)
  return data
}

export async function regenerateAppSecret(appId: string): Promise<{ appSecret: string }> {
  const { data } = await http.post<{ appSecret: string }>(
    `/merchants/apps/${appId}/regenerate-secret`,
  )
  return data
}

export { extractError }
