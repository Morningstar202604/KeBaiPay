# KeBaiPay Web H5 — 用户端 H5

KeBaiPay 用户端移动 H5（**钱包 / 收银台 / 红包**），使用 **Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus** 构建，移动端优先。

> 本项目是路线图「用户端 H5 优化（Vue 3 + Vite）」的落地实现，调用后端真实接口（`/auth/*`、`/accounts/me`、`/transactions/recharge`、`/transfers`、`/withdrawals`、`/red-packets/*`、`/bills`、`/cashier/orders/*`）。

## 已实现模块

- **钱包首页**：余额总览（可用/冻结/总额）+ 快捷操作（充值/转账/提现/红包）+ 最近账单
- **充值**：创建充值订单（Mock/真实渠道）
- **转账**：用户间转账（支付密码 + 幂等）
- **提现**：银行卡提现申请
- **红包**：拼手气/普通红包发放、按红包编号领取、已发红包列表
- **账单**：收支筛选（INCOME/EXPENSE）
- **收银台**：创建付款订单、订单列表、余额支付

## 目录结构

```
web-h5/
├── src/
│   ├── api/http.ts          # Axios：Bearer token、401 处理、错误解析
│   ├── api/modules.ts       # 用户端接口封装
│   ├── types/index.ts       # 类型定义
│   ├── stores/auth.ts       # Pinia auth store
│   ├── router/index.ts      # 路由 + 登录守卫
│   ├── layout/H5Layout.vue  # 顶部标题栏 + 底部导航
│   └── views/               # Login / Home / Recharge / Transfer / Withdraw / RedPacket / Bills / Cashier
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `VITE_API_BASE` | 后端 API 地址。开发默认 `http://localhost:3000`；生产留空（同源） |

## 开发 / 构建

```bash
cd web-h5
npm install
npm run dev          # 5174，API 代理到后端
npm run build        # 产物 web-h5/dist
```

构建产物由后端 NestJS 挂载到 **`/h5`**（`src/app.module.ts` 的 `spaStaticModules()`）。

## 部署

1. `cd web-h5 && npm ci && npm run build`
2. 启动后端 `npm run start:prod`
3. 访问 `http://<host>:<port>/h5`

## 后续迭代候选

- [ ] 收银台扫码收款（`/cashier/qrcode/:code` + `/qr-codes/pay`）
- [ ] 收款码展示与分享
- [ ] 实名认证 / 绑卡流程 H5 化
