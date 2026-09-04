import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// KeBaiPay 管理后台
export default defineConfig(({ mode }) => {
  const apiBase = process.env.VITE_API_BASE || ''
  const prod = mode === 'production'

  return {
    plugins: [vue()],
    base: prod ? '/admin/' : '/',
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '0.0.0.0',
      port: 5175,
      proxy: {
        '/admin': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        // 智能体管理接口（AgentView 使用）
        '/agent': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
