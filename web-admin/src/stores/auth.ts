import { defineStore } from 'pinia'
import { TOKEN_KEY } from '@/api/http'
import * as api from '@/api/modules'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    username: localStorage.getItem('kebaipay_admin_name') || '',
  }),
  getters: {
    isAuthenticated: (s) => !!s.token,
  },
  actions: {
    setSession(token: string, username: string) {
      this.token = token
      this.username = username
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem('kebaipay_admin_name', username)
    },
    async login(body: { username: string; password: string }) {
      const res = await api.adminLogin(body)
      this.setSession(res.token, res.admin?.username || body.username)
      return res
    },
    logout() {
      this.token = ''
      this.username = ''
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('kebaipay_admin_name')
    },
  },
})
