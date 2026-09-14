import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kebaipay.app',
  appName: 'KeBaiPay 科佰支付',
  webDir: 'dist',
  // App 内以绝对地址访问后端：构建时经 VITE_API_BASE 注入（见 android README）
  server: {
    // 允许 cleartext http 仅用于开发联调；生产请使用 https 并移除
    cleartext: true,
  },
}

export default config
