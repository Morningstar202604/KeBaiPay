import axios, { AxiosError } from 'axios'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import router from '@/router'

// 后端 API 基础地址。生产留空 = 同源（由 NestJS 托管）；开发时由 .env 指定
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) || ''

export const TOKEN_KEY = 'kebaipay_portal_token'

const http = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 后端错误统一包在 { code, message } 中
export function extractError(e: unknown): string {
  const err = e as AxiosError<{ message?: string; code?: string }>
  const data = err?.response?.data
  if (data && data.message) return `${data.code ? data.code + ' ' : ''}${data.message}`
  return err?.message || '网络错误，请稍后重试'
}

http.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status
    if (status === 401) {
      const auth = useAuthStore()
      auth.logout()
      ElMessage.error('登录已过期，请重新登录')
      router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
    }
    return Promise.reject(error)
  },
)

export default http
