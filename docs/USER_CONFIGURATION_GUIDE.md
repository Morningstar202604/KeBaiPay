# KeBaiPay 使用与配置总指南

> 一份文档带你：**看懂这个程序、会用这个程序、配好这个程序**。
> 含 3 端角色使用说明、全部功能配置、外部服务（短信/邮件/LLM/支付渠道/可观测性）接入、智能体配置、部署。
> 本平台为**合规聚合收单技术服务**：不设余额/充值/提现/转账/红包/分账/担保。

---

## 1. 三端角色

| 端 | 使用者 | 主要能力 |
|---|---|---|
| 用户端 H5 | 付款方用户 | 注册/登录、实名认证、收银台付款、查账单、领优惠券、AI 助手 |
| 商户门户 Portal | 商户 | 入驻审核、应用管理、收款码、订单看板、对账导出 |
| 管理后台 Admin | 平台运营 | 用户/商户/实名审核、收单订单监管、渠道配置、财务聚合、对账、风控、智能体管理、系统配置 |

---

## 2. 必须配置的环境变量

| 变量 | 用途 |
|---|---|
| `JWT_USER_SECRET` | 用户 JWT 签名 |
| `JWT_ADMIN_SECRET` | 管理员 JWT 签名 |
| `ENCRYPTION_KEY` | 渠道凭据 AES-256-GCM 加密 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `CHANNEL_NOTIFY_URL` | 收单结果回调公网地址（持牌通道确认支付结果） |
| `LLM_PROVIDER` / `LLM_API_KEY` | AI 智能体 LLM 配置（未配置则为 mock 模板回复） |
| `SMS_*` | 短信接入 |

完整列表见 [CONFIGURATION.md](CONFIGURATION.md)。

---

## 3. 支付渠道配置

在管理后台「渠道配置」中新增渠道（微信/支付宝/mock），凭据 AES-256-GCM 加密落库，保存后热同步。默认仅启用 mock 渠道。

生产环境必须：
- 接入真实持牌渠道
- 配置 `CHANNEL_NOTIFY_URL` 为公网可达 HTTPS 地址
- 关闭 `SANDBOX_AUTO_APPROVE`

---

## 4. 智能体（AI Agent）配置

1. 在 `.env` 配置 `LLM_PROVIDER` 与 `LLM_API_KEY`
2. 管理后台「智能体管理」创建智能体，配置作用域（scope）
3. 用户在 H5「AI 助手」页连接智能体并授权
4. 所有工具调用受单笔/日限额与二次确认约束，进审计哈希链

---

## 5. 部署

- 开发：`docker compose -f docker-compose.dev.yml up -d` + `npm run start:dev`
- 生产：见 [DEPLOYMENT.md](DEPLOYMENT.md)
- HTTPS：见 [HTTPS_SETUP.md](HTTPS_SETUP.md)

---

## 6. 文档地图

| 主题 | 文档 |
|---|---|
| 快速接入 | [QUICKSTART.md](QUICKSTART.md) |
| 商户手册 | [MERCHANT_GUIDE.md](MERCHANT_GUIDE.md) |
| 用户手册 | [USER_GUIDE.md](USER_GUIDE.md) |
| 管理员手册 | [ADMIN_GUIDE.md](ADMIN_GUIDE.md) |
| API 参考 | [API_REFERENCE.md](API_REFERENCE.md) |
| SDK | [SDK_GUIDE.md](SDK_GUIDE.md) |
| 合规模式 | [COMPLIANCE_MODE.md](COMPLIANCE_MODE.md) |
| 生产就绪 | [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) |
| 排障 | [TROUBLESHOOT.md](TROUBLESHOOT.md) |
