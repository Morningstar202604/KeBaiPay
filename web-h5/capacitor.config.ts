import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kebaipay.app',
  appName: 'KeBaiPay 科佰支付',
  webDir: 'dist',
  // App 内以绝对地址访问后端：构建时经 VITE_API_BASE 注入（见 android README）
  server: {
    // 生产默认禁止明文 HTTP（配合 AndroidManifest usesCleartextTraffic=false）。
    // 仅本地开发联调需要 http 时，临时改为 cleartext: true 并务必在发布前改回。
    cleartext: false,
  },
}

export default config
