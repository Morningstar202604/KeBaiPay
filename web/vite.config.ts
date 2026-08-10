import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// KeBaiPay 商户后台
// - 开发模式：VITE_API_BASE 指向后端（默认 http://localhost:3001）
// - 生产构建：VITE_API_BASE 留空（同源，由 NestJS 静态服务托管）
export default defineConfig(({ mode }) => {
  const apiBase = process.env.VITE_API_BASE || ''
  const prod = mode === 'production'

  return {
    plugins: [vue()],
    base: prod ? '/portal/' : '/',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        // 开发时将 API 请求代理到后端（保留同源相对路径调用习惯）
        '/auth': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/merchants': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/cashier': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/users': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/accounts': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
