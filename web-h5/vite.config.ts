import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// KeBaiPay 用户端 H5
export default defineConfig(({ mode }) => {
  const apiBase = process.env.VITE_API_BASE || ''
  const prod = mode === 'production'

  return {
    plugins: [
      vue(),
      // Element Plus 组件级按需引入：模板里用到哪个 el-* 组件就打包哪个（含样式），
      // 配合 main.ts 中手动补的 message/message-box 样式，主包体积约减 60%
      Components({ resolvers: [ElementPlusResolver()] }),
    ],
    // 部署 base：默认服务器子路径 /h5/；打安卓包时经 VITE_APP_BASE=/ 覆盖
    // （Capacitor WebView 从 https://localhost/ 根路径加载，带子路径会 404 白屏）
    base: process.env.VITE_APP_BASE || (prod ? '/h5/' : '/'),
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
      proxy: {
        '/auth': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/accounts': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/transactions': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/transfers': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/withdrawals': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/red-packets': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/bills': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/cashier': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/qr-codes': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        '/users': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
        // 智能体对话接口（AgentChatView 使用）
        '/agent': { target: apiBase || 'http://localhost:3001', changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
