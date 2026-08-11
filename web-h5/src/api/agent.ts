import axios from 'axios'
import { ElMessage } from 'element-plus'

// 使用 Agent token 调用的接口（AgentAuthGuard）。与用户端 http 实例分离，避免 token 冲突。
const API_BASE: string = (import.meta.env.VITE_API_BASE as string) || ''

export function agentError(e: unknown): string {
  const err = e as { response?: { data?: { message?: string } } }
  const msg = err?.response?.data?.message
  return msg || '智能体请求失败'
}

export async function agentRequest<T = unknown>(
  token: string,
  method: 'get' | 'post',
  url: string,
  data?: unknown,
): Promise<T> {
  try {
    const res = await axios({
      baseURL: API_BASE,
      method,
      url,
      data,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60000,
    })
    return res.data as T
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 401) {
      ElMessage.error('智能体令牌失效，请重新连接')
    }
    throw e
  }
}
