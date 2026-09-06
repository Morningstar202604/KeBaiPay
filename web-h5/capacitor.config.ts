import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kebaipay.app',
  appName: '科佰钱包',
  webDir: 'dist',
  // 安卓 WebView 使用 http scheme 并允许明文流量：
  // 便于连接局域网/自托管后端（生产 HTTPS 部署后可收紧）
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
