import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// KeBaiPay 用户端 H5
export default defineConfig(({ mode }) => {
  const apiBase = process.env.VITE_API_BASE || ''
  const prod = mode === 'production'

  return {
    plugins: [vue()],
    base: prod ? '/h5/' : '/',
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
      proxy: {
        '/auth': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/accounts': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/transactions': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/transfers': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/withdrawals': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/red-packets': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/bills': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/cashier': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/qr-codes': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
        '/users': { target: apiBase || 'http://localhost:3000', changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
