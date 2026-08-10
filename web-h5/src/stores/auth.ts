import { defineStore } from 'pinia'
import { TOKEN_KEY } from '@/api/http'
import * as api from '@/api/modules'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    userId: localStorage.getItem('kebaipay_h5_user_id') || '',
  }),
  getters: {
    isAuthenticated: (s) => !!s.token,
  },
  actions: {
    setSession(token: string, userId: string) {
      this.token = token
      this.userId = userId
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem('kebaipay_h5_user_id', userId)
    },
    async login(body: { phone?: string; email?: string; password: string }) {
      const res = await api.login(body)
      this.setSession(res.token, res.userId)
      return res
    },
    logout() {
      this.token = ''
      this.userId = ''
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('kebaipay_h5_user_id')
    },
  },
})
