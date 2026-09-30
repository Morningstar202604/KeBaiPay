# KeBaiPay 开发者指南

> 科佰支付 - 合规聚合收单技术服务参考实现（v0.3.5）
> 资金绝不过平台：不设余额/充值/提现/转账/红包/分账/担保/批量代付/订阅/返现。

## 目录

- [快速开始](#快速开始)
- [项目架构](#项目架构)
- [模块开发规范](#模块开发规范)
- [认证方式](#认证方式)
- [API 端点索引](#api-端点索引)
- [错误码规范](#错误码规范)
- [频率限制](#频率限制)
- [调度任务](#调度任务nestjsschedule)
- [常见问题](#常见问题)

---

## 快速开始

### 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | >= 20 | NestJS 11 + TypeScript |
| PostgreSQL | >= 16 | 不再支持 SQLite |
| Redis | >= 7 | 生产环境必填，收单并发安全靠它 |

### 安装与启动

```bash
git clone https://github.com/x33834/KeBaiPay.git
cd KeBaiPay
npm install
cp .env.example .env
# 编辑 .env，至少修改 JWT_USER_SECRET、JWT_ADMIN_SECRET 和 ENCRYPTION_KEY
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

服务启动后：
- API 服务：`http://localhost:3001`
- Swagger 文档：`http://localhost:3001/api/docs`（仅开发环境）

### 常用命令

```bash
npm run build
npm run start:prod
npm run test
npm run lint
npm run migrate:dev
npm run migrate:deploy
```

---

## 项目架构

```
src/
├── auth/                # 用户认证（注册、登录、JWT）
├── users/               # 用户管理（实名认证、支付密码、绑定手机/邮箱）
├── merchants/           # 商户管理（入驻、应用、收款码）
├── cashier/             # 收银台（收单订单、渠道支付、扫码）
├── open-api/            # 开放 API（HMAC 签名、创建订单、查单、退款、收单统计）
├── payment-channels/    # 渠道抽象层（微信/支付宝/mock，收单/退款/查单）
├── webhooks/            # 渠道回调（收单回调、退款回调，验签优先）
├── bills/               # 账单查询
├── invoices/            # 发票
├── coupons/             # 优惠券
├── finance/             # 财务聚合（概览、每日汇总、结算、快照、通道账单对账 reconciliation）
├── risk/                # 风控引擎
├── admin/               # 管理后台（用户/商户/实名/订单/风控/渠道/系统配置）
├── agent/               # AI 智能体（会话、工具、MCP、审计链）
├── health/              # 健康检查与 Prometheus 指标
├── messages/            # 消息中心
├── qr-codes/            # 收款码
├── sms/                 # 短信
├── common/              # 公共装饰器/校验器/常量/枚举/错误码
├── audit/               # 审计日志（哈希链）
├── crypto/              # AES-256-GCM 信封加密
└── prisma/              # Prisma client
```

> 已物理删除的旧模块（不要在代码中引用）：`accounts/`、`transactions/`、`transfers/`、`withdrawals/`、`red-packets/`、`bank-cards/`、`escrow/`、`batch-transfers/`、`subscriptions/`、`splits/`、`referrals/`、`finance/journal.service.ts`。

---

## 模块开发规范

- 每个业务模块目录下：`*.module.ts`、`*.controller.ts`、`*.service.ts`、`dto/`、可能的 `*.schedule.ts`
- 控制器只做参数校验与转发，业务逻辑在 service
- 并发安全：跨 service 写操作必须使用 Redis 分布式锁（`redis.withLock`）+ 条件原子更新
- 对外回调必须先验签再做幂等
- 所有金额以「分」为单位在数据库存储，DTO 以「元」为单位

---

## 认证方式

### 用户 JWT 认证
`Authorization: Bearer <user-jwt>`，用于 `/users/*`、`/cashier/*`、`/merchants/*`、`/bills/*`、`/coupons/*`、`/messages/*` 等。

### 管理员认证
`Authorization: Bearer <admin-jwt>`，用于 `/admin/*`。角色权限见 `src/admin/permissions.decorator.ts`。

### 商户 HMAC 签名
`X-App-Id` / `X-Timestamp` / `X-Nonce` / `X-Signature`，用于 `/open-api/v1/*`。签名算法：HMAC-SHA256，密钥为 `appSecret` 的 32 字节原始摘要（`SHA256_RAW(appSecret)`，不是明文、也不是 hex 字符串），签名串为 `` `${method}\n${path}\n${rawBody}\n${timestamp}\n${nonce}\n${appId}` ``。

### Agent 认证
`Authorization: Bearer <agent-jwt>`，用于 `/agent/*`（用户侧智能体会话）。管理端智能体 CRUD 走 `/agent/admin/*`，需管理员 JWT。

---

## API 端点索引

共 **136 个操作 / 121 条路径**，完整清单见 [API_REFERENCE.md](API_REFERENCE.md) 与机器可读的 [openapi.json](openapi.json)。按模块分组：

| 模块 | 前缀 | 主要职责 |
|---|---|---|
| auth | `/auth` | 注册/登录 |
| users | `/users` | 个人信息、实名、支付密码、绑定 |
| merchants | `/merchants` | 入驻、应用、收款码、看板 |
| cashier | `/cashier` | 收银台订单、渠道支付、扫码 |
| open-api | `/open-api/v1` | 商户服务端收单/退款/统计 |
| payment-channels | （服务层） | 渠道收单/退款/查单抽象 |
| webhooks | `/webhooks` | 渠道收单/退款回调 |
| bills | `/bills` | 账单 |
| invoices | `/invoices`、`/admin/invoices` | 发票 |
| coupons | `/coupons` | 优惠券 |
| finance | `/admin/finance` | 财务聚合、结算、快照 |
| reconciliation | `/admin/reconciliation` | 渠道账单对账 |
| admin | `/admin/*` | 管理后台 |
| agent | `/agent/*` | AI 智能体 |
| health | `/health`、`/metrics` | 健康检查、指标 |
| sms | `/sms` | 短信 |
| messages | `/messages` | 消息 |
| qr-codes | `/qr-codes` | 收款码 |

---

## 错误码规范

统一格式：`{ "statusCode": number, "message": "KBxxx 错误描述" }`。错误码定义见 `src/common/error-codes.ts`。

---

## 频率限制

- 开放 API：按 `appId` 维度限流，时间窗 + nonce 防重放
- 用户端：按用户 ID 限流
- 登录/注册：IP + 账号双维度，连续失败锁定

---

## 调度任务（@nestjs/schedule）

| 任务 | 周期 | 作用 |
|---|---|---|
| 收单掉单补单 | 每分钟 | PENDING 超时订单主动查渠道 |
| 渠道账单拉取 | 每日凌晨 | 拉取渠道官方账单 |
| 渠道账单对账 | 每日 | 逐笔匹配平台收单订单 |
| 每日快照 | 每日 | 生成财务日快照 |
| 审计哈希链校验 | 每小时 | 校验审计日志链完整性 |
| Agent 授权过期清理 | 每小时 | 清理过期 Agent 授权 |

---

## 常见问题

- **怎么接新渠道？** 实现 `PaymentChannel` 接口（收单/查单/退款/回调解析），在 `payment-channel.registry.ts` 注册。
- **回调验签在哪？** `src/webhooks/webhooks.controller.ts` + 各渠道的 `verifyCallbackSignature`。
- **为什么没有复式记账？** 资金不过平台，平台不设账本；财务数据为收单订单聚合，不是复式账。
- **如何保证回调不重复入账？** 渠道回调共用一把分布式锁 + 幂等键唯一约束 + 金额 fail-closed 校验。
