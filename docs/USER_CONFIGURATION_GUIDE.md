# KeBaiPay 使用与配置总指南

> 一份文档带你：**看懂这个程序、会用这个程序、配好这个程序**。
> 含 3 端角色使用说明、全部功能配置、外部服务（短信/邮件/LLM/支付/可观测性）接入、智能体配置、部署。
> 需要更细的分主题时，文末有完整文档地图。

---

## 1. 这是什么 & 演示

KeBaiPay 是一个**开源一体化支付中台**：个人钱包 + 商户收款 + 开放 API + 多平台对账 + AI 智能体层。技术栈 NestJS 11 + Prisma 7 + PostgreSQL + Redis + Vue 3。

**🎬 在线演示**：`demo/README.md`
- **截屏**：`demo/screenshots/`（24 张，覆盖三端全部功能）
- **录屏**：`demo/videos/`
  - `kebaipay-showcase.webm`（**精编合集**：商户后台 + 用户 H5 + 管理后台精华）
  - `portal-demo.webm` / `h5-demo.webm` / `admin-demo.webm`（分端完整）
  - `admin-review.webm`（管理员审核交互）

| 端 | 入口 | 面向 | 演示账号 |
|---|---|---|---|
| 用户钱包 H5 | `/h5` | C 端用户 | `13800000001` / `Abc12345`（支付密码 `123456`） |
| 商户后台 | `/portal` | B 端商户 | 同上（已入驻"MVP演示商户"，余额 ¥10000，8 笔订单） |
| 管理后台 | `/admin` | A 端运营 | `admin` / 密码取 `.env` 的 `ADMIN_DEFAULT_PASSWORD`（example 默认 `ChangeAdmin2026`） |

---

## 2. 怎么用（三端角色）

### 2.1 用户端 H5（`/h5`）
- **注册/登录** → 实名认证 → 设置支付密码。
- **钱包首页**：查看余额（可用/冻结/总额）、最近账单。
- **充值 / 转账 / 提现 / 红包 / 收银台付款 / 账单筛选**。
- **AI 智能助手**：选智能体 → 一键授权 → 多轮对话（查余额/账单）→ 资金操作二次确认。
- 详细步骤见 `docs/USER_GUIDE.md`。

### 2.2 商户后台（`/portal`）
- **入驻**：登录后未入驻先提交入驻申请（需先实名），管理员审核通过。
- **数据看板**：今日/近7天/近30天交易额、净收入。
- **订单管理**：按状态/日期筛选、回调状态、**手动重试回调**。
- **对账查询 / 收款码 / 应用管理（AppID+密钥）/ 商户资料**。
- 详细见 `docs/MERCHANT_GUIDE.md`、`docs/MERCHANT_INTEGRATION.md`。

### 2.3 管理后台（`/admin`）
- **数据概览 / 用户管理（冻结）/ 商户审核 / 提现审核（通过·拒绝）/ 支付订单 / 财务总览 / 风控事件 / 智能体管理**。
- 支付渠道在「渠道管理」页配置（存库）。
- 详细见 `docs/ADMIN_GUIDE.md`。

---

## 3. 怎么配置（全部功能）

### 3.0 配置入口速览

| 配置 | 在哪配置 | 说明 |
|---|---|---|
| 全部环境变量 | `.env`（拷 `.env.example`） | 数据库/Redis/密钥/SMS/邮件/LLM/回调等 |
| 支付渠道 | 管理后台 → 渠道管理 | 支付宝/微信/Mock |
| 智能体 | 管理后台 → 智能体管理 | 创建/停用/作用域 |
| 短信 | `.env`（`SMS_*`） | 阿里/腾讯/华为 |
| 邮件 | `.env`（`SMTP_*`） | SMTP |
| LLM | `.env`（`LLM_*`） | OpenAI 兼容 |
| 可观测性 | `.env`（`OTEL_*`/`SENTRY_DSN`） | 可选 |

### 3.1 一键自检（强烈建议先跑）
```bash
npm run check:external
```
逐项告诉你每个外部服务还缺什么、该填什么；把 `✗` 项补进 `.env` 重启即接入。

### 3.2 环境变量分组（`docs/EXTERNAL_QUICKSTART.md` + `docs/DEPLOYMENT.md` 有完整说明）

| 分组 | 关键变量 | 用途 |
|---|---|---|
| Server | `NODE_ENV` `PORT` `CORS_ORIGINS` | 运行环境、跨域 |
| 数据库 | `DATABASE_URL` `DATABASE_CONNECTION_LIMIT` … | PostgreSQL 连接与池调优 |
| Redis | `REDIS_URL` | 分布式锁/限流/防重放 |
| 密钥 | `JWT_USER_SECRET` `JWT_ADMIN_SECRET` `JWT_AGENT_SECRET` `ENCRYPTION_KEY` `ADMIN_DEFAULT_PASSWORD` | 认证与加密（生产 ≥32 位强随机） |
| 短信 | `SMS_PROVIDER` `SMS_SIGN_NAME` `SMS_TEMPLATE_CODE` `SMS_ACCESS_KEY_ID/SECRET`（或腾讯/华为项） | 手机号验证码 |
| 支付 | `RECHARGE_NOTIFY_URL` `CASHIER_BASE_URL` + 渠道管理配置 | 回调与收银台 |
| 邮件 | `SMTP_HOST/PORT/USER/PASS/FROM` | 邮件通知 |
| LLM | `LLM_PROVIDER` `LLM_API_KEY` `LLM_BASE_URL` `LLM_MODEL` `LLM_TIMEOUT_MS` … | AI 智能体/风控审计 |
| 智能体 | `JWT_AGENT_EXPIRES_IN` `AGENT_MAX_AMOUNT_PER_OP/DAY` `AGENT_CONFIRM_TIMEOUT_SEC` | Agent token 与限额/确认超时 |
| 可观测性 | `OTEL_EXPORTER_OTLP_ENDPOINT` `SENTRY_DSN` | 链路/异常上报 |

### 3.3 外部服务接入（"只需最后一步"）
- **短信**：阿里/腾讯/华为云实名 → 签名 + 模板（变量名 `code`）→ 填 `SMS_*`。详见 `docs/sms-integration.md`。
- **邮件**：企业邮箱/第三方 SMTP → 填 `SMTP_*`。
- **LLM**：任意 OpenAI 兼容服务（DeepSeek/通义/Kimi/Moonshot）→ 填 `LLM_PROVIDER/API_KEY/BASE_URL/MODEL`。
- **支付渠道**：企业资质 + 商户号/证书 → 管理后台「渠道管理」配置 `alipay`/`wechat`；对外收单需持牌/聚合通道（合规红线见 `docs/PRODUCTION_READINESS.md` §2.3）。
- **可观测性**：OTLP Collector / Sentry DSN（可选）。

> 完整资质清单（外部依赖总表）见 `docs/PRODUCTION_READINESS.md` 顶部速查表。

### 3.4 智能体配置
- 管理后台 → 智能体管理：新建（选场景 wallet/merchant/risk/support）、配置作用域（`wallet:read` 等）、启用/停用。
- 用户 H5 → AI 智能助手：授权 → 连接 → 对话。
- 资金类操作默认**人工二次确认**，受 `AGENT_MAX_AMOUNT_PER_OP/DAY` 限额保护。
- 测试与已知限制见 `docs/AGENT_TEST_REPORT.md`。

### 3.5 前端
- 三端为独立 Vite 工程：`web/`（商户，挂载 `/portal`）、`web-h5/`（用户，挂载 `/h5`）、`web-admin/`（管理，挂载 `/admin`）。
- 构建：`cd web && npm ci && npm run build`（产物 `web/dist`，后端自动托管）。
- 配置：`VITE_API_BASE`（开发指向后端，生产留空同源）。

---

## 4. 部署

```bash
npm ci && npx prisma migrate deploy && npx ts-node prisma/seed.ts
# 先构建三端前端（见上），再：
NODE_ENV=production node dist/main.js   # 或用 docker-compose
```
详见 `docs/DEPLOYMENT.md`（Docker/裸机/nginx/HTTPS/备份）。

---

## 5. 文档地图

| 需求 | 文档 |
|---|---|
| 用户怎么用 | `docs/USER_GUIDE.md` |
| 商户怎么用/对接 | `docs/MERCHANT_GUIDE.md` / `docs/MERCHANT_INTEGRATION.md` |
| 管理员怎么用 | `docs/ADMIN_GUIDE.md` |
| API 参考 | `docs/API_REFERENCE.md` |
| 外部服务接入（最后一步） | `docs/EXTERNAL_QUICKSTART.md` |
| 生产就绪 / 合规 / 资质 | `docs/PRODUCTION_READINESS.md` |
| 短信接入 | `docs/sms-integration.md` |
| 部署 | `docs/DEPLOYMENT.md` |
| Agent 测试报告 | `docs/AGENT_TEST_REPORT.md` |
| 演示 | `demo/README.md` |
| 排障 | `docs/TROUBLESHOOT.md` |
