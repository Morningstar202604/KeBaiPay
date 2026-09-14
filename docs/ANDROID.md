# KeBaiPay 安卓端（Capacitor）

> 安卓端基于 **Capacitor** 将 `web-h5`（Vue 3 + Vite）打包为原生 App，业务代码与 H5 完全同源——改 H5 即改 App，不需要维护两套前端。

## 一、目录与依赖

- 容器工程：`web-h5/android/`（原生壳，一般不需要动）
- Web 资产：`web-h5/dist/`（由 `npm run build` 产出，经 `npx cap sync` 同步进原生壳）
- 依赖：`@capacitor/core` / `@capacitor/cli` / `@capacitor/android`（devDependencies）

## 二、关键概念：API 地址

浏览器里 H5 与后端同源部署（相对路径请求即可），但 **App 的 origin 不是后端域名**，必须使用绝对地址：

- 构建时通过环境变量注入：`VITE_API_BASE=https://api.your-domain.com`
- 该值在 `web-h5/src/api/http.ts` 中被读取为 axios `baseURL`，**构建时固化**进产物

当前沙箱产出的 debug 包默认指向 `http://10.0.2.2:3001`——这是 **Android 模拟器访问宿主机** 的保留地址，适合本地联调；真机/生产请按下面流程重新打包。

## 三、本地构建流程（开发者）

前置要求：Node 20+、JDK 17+（建议 17 或 21）、Android SDK（Platform 36 + Build-Tools 36 + Platform-Tools）、Android Studio（可选）。

```bash
cd web-h5

# 1. 构建前端，注入你的后端地址
VITE_API_BASE=https://api.your-domain.com npm run build:only

# 2. 同步 web 资产到原生工程
npx cap sync android

# 3. 构建 APK
cd android
./gradlew assembleDebug          # 调试包（自动 debug 签名，可直接安装）
./gradlew assembleRelease        # 发布包（需先配置签名，见下节）
```

产物位置：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 四、发布签名（Release）

```bash
# 1. 生成签名密钥（一次即可，妥善保管，丢了就无法同签名更新）
keytool -genkey -v -keystore kebaipay-release.keystore \
  -alias kebaipay -keyalg RSA -keysize 2048 -validity 10000

# 2. android/keystore.properties（不要提交到 git）
storeFile=/absolute/path/kebaipay-release.keystore
storePassword=***
keyAlias=kebaipay
keyPassword=***

# 3. android/app/build.gradle 的 android{} 块中加入 signingConfigs 并在 buildTypes.release 引用
# 4. ./gradlew assembleRelease
```

## 五、安全注意

- `capacitor.config.ts` 中 `server.cleartext: true` 仅用于**本地 http 联调**；生产地址为 https 时建议移除，强制 TLS；
- 生产 APK 请关闭 WebView 远程调试（debug 包默认开启，release 不受影响）；
- App 内 token 存于 localStorage（与 H5 一致），如需更高安全等级可引入 `@capacitor/preferences` 或 KeyStore 方案，属后续增强项。

## 六、常见问题

| 现象 | 原因与处理 |
|---|---|
| App 内所有请求 404 / 网络错误 | `VITE_API_BASE` 未注入或指向了不可达地址；重新执行第二节流程 |
| 模拟器连不上本机后端 | 模拟器内宿主机地址是 `http://10.0.2.2:<端口>`，不是 localhost |
| `gradlew: permission denied` | `chmod +x gradlew`（Windows 下用 `gradlew.bat`） |
| 构建报 SDK 版本不匹配 | 工程要求 Android 36 / Build-Tools 36，用 `sdkmanager` 安装对应组件 |
| gradle.properties 中的 `org.gradle.java.home` | 按本机 JDK 路径修改，Windows 用户注意盘符写法（`C:/...`） |

## 七、iOS 呢？

同一套 Capacitor 架构天然支持 iOS（`npx cap add ios`），但构建需要 macOS + Xcode，属后续按需补充项。
