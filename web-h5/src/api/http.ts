import axios, { AxiosError } from 'axios'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import router from '@/router'

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) || ''
export const TOKEN_KEY = 'kebaipay_h5_token'

const http = axios.create({ baseURL: API_BASE, timeout: 15000 })

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  // 统一剔除空筛选参数：空串/空值传给后端会触发 KB400 校验失败
  if (config.params && typeof config.params === 'object') {
    config.params = Object.fromEntries(
      Object.entries(config.params).filter(
        ([, v]) => v !== '' && v !== null && v !== undefined,
      ),
    )
  }
  return config
})

export function extractError(e: unknown): string {
  const err = e as AxiosError<{ message?: string; code?: string }>
  const data = err?.response?.data
  if (data && data.message) return `${data.code ? data.code + ' ' : ''}${data.message}`
  return err?.message || '网络错误，请稍后重试'
}

http.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ message?: string }>) => {
    if (error.response?.status === 401) {
      useAuthStore().logout()
      ElMessage.error('登录已过期，请重新登录')
      router.push({ name: 'login' })
    }
    return Promise.reject(error)
  },
)

export default http
