# KeBaiPay Web — 商户后台（Vue 3 SPA）

KeBaiPay 商户后台前端，使用 **Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + ECharts** 构建。

> 现状说明：本项目源自路线图「P0 商户后台前端 SPA」。当前实现 **数据看板 / 订单管理 / 对账查询 / 收款码 / 应用管理 / 商户资料 / 商户入驻申请** 七个模块，调用后端真实接口（`/merchants/*`、`/cashier/orders/*`、`/auth/login`）。

## 技术栈

- Vue 3（Composition API + `<script setup>`）
- Vite 6 + TypeScript
- Pinia（认证会话持久化）
- Vue Router（生产 hash 模式，规避刷新 404）
- Element Plus（中文 locale）
- ECharts（数据看板图表）
- Axios（统一鉴权拦截 + 401 自动登出）

## 目录结构

```
web/
├── src/
│   ├── api/http.ts          # Axios 实例：注入 Bearer token、401 处理、错误解析
│   ├── api/modules.ts       # 商户/收银台/认证接口封装
│   ├── types/index.ts       # 与后端契约对齐的类型定义
│   ├── stores/auth.ts       # Pinia auth store（token 持久化）
│   ├── router/index.ts      # 路由 + 登录守卫
│   ├── layout/PortalLayout.vue
│   └── views/               # LoginView / DashboardView / OrdersView / ReconciliationView / QrCodesView / AppsView / MerchantInfoView / MerchantRegisterView
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `VITE_API_BASE` | 后端 API 地址。开发默认 `http://localhost:3001`；生产留空（同源，由 NestJS 托管） |

## 开发

```bash
cd web
npm install
npm run dev          # 默认 5173，Vite 将 /auth /merchants /cashier 等代理到后端
```

## 构建

```bash
cd web
npm run build        # vue-tsc 类型检查 + vite 构建，产物输出到 web/dist
```

构建产物由后端 NestJS 挂载到 **`/portal`**（`src/app.module.ts` 的 `portalStaticModules()`），仅当 `web/dist` 存在时注册。生产环境需要先构建 `web` 再启动后端。

## 部署

1. `cd web && npm ci && npm run build`（产出 `web/dist`）
2. 启动后端 `npm run start:prod`
3. 访问 `http://<host>:<port>/portal`

## 后续迭代候选

- [x] 商户入驻申请流程页（未入驻时引导入驻，入驻需先实名认证）
- [x] Webhook 回调重试可视化（订单回调状态 + 重试次数 + 手动重发）
- [ ] 用户端 H5（钱包 / 收银台 / 红包）Vue 3 化（路线图 P1）
- [ ] 管理后台 Vue 3 化
