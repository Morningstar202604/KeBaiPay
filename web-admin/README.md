# KeBaiPay Web Admin — 管理后台 Vue 3 SPA

KeBaiPay 管理后台前端，使用 **Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + ECharts** 构建。

> 覆盖管理端核心面板：**数据概览 / 用户管理 / 商户管理（审核）/ 提现审核 / 支付订单 / 财务总览 / 风控事件**，调用后端真实接口（`/admin/*`）。

## 已实现模块

| 模块 | 接口 |
|---|---|
| 登录 | `POST /admin/auth/login` |
| 数据概览 | `GET /admin/dashboard` |
| 用户管理（搜索/冻结/解冻） | `GET /admin/users`、`POST /admin/users/:id/status` |
| 商户管理（审核通过/驳回） | `GET /admin/merchants`、`POST /admin/merchants/:id/audit` |
| 提现审核（通过/拒绝） | `GET /admin/withdrawals`、`POST /admin/withdrawals/:id/approve\|reject` |
| 支付订单 | `GET /admin/payment-orders` |
| 财务总览 | `GET /admin/finance/overview` |
| 风控事件（处置） | `GET /admin/risk-events`、`POST /admin/risk-events/:id/handle` |

## 环境变量

| 变量 | 说明 |
|---|---|
| `VITE_API_BASE` | 后端 API 地址。开发默认 `http://localhost:3001`；生产留空（同源） |

## 开发 / 构建

```bash
cd web-admin
npm install
npm run dev          # 5175，/admin 代理到后端
npm run build        # 产物 web-admin/dist
```

构建产物由后端 NestJS 挂载到 **`/admin`**（`src/app.module.ts` 的 `spaStaticModules()`）。

## 部署

1. `cd web-admin && npm ci && npm run build`
2. 启动后端 `npm run start:prod`
3. 访问 `http://<host>:<port>/admin`（管理员登录）

## 后续迭代候选

- [ ] 实名认证审核面板（`/admin/identity/*`）
- [ ] 系统配置 / 风险规则（`/admin/system-configs`、`/admin/risk-rules`）
- [ ] 操作审计日志 / 登录日志（`/admin/audit-logs`、`/admin/login-logs`）
- [ ] 对账报告面板（`/admin/reconciliation/*`）
