<div align="center">

# 💳 KeBaiPay 科佰支付

**能自己跑起来的一套支付中台：钱包、收单、开放 API、对账、AI 智能体，五层打通**

`NestJS 11` · `TypeScript 6` · `Prisma 7` · `PostgreSQL 16` · `Redis 7` · `Vue 3` · `MCP`

[![CI](https://github.com/x33834/KeBaiPay/actions/workflows/ci.yml/badge.svg)](https://github.com/x33834/KeBaiPay/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.3.0-0FA968)](docs/CHANGELOG.md)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![tests](https://img.shields.io/badge/tests-1178%20passing-0FA968)](docs/CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-0FA968)](LICENSE)

[快速开始](#-快速开始) · [它能做什么](#-它能做什么) · [界面预览](#-界面预览) · [为什么值得一看](#-为什么值得一看) · [文档](#-文档) · [镜像仓库](#-镜像仓库)

</div>

---

## 📖 这到底是什么

一个**可以私有化部署的支付系统参考实现**。不是玩具 demo——微信/支付宝 SDK 直连、复式记账、分布式锁、幂等键、审计哈希链这些工业级该有的东西都在，220 个 API 端点、41 个业务模块、1178 个单元测试。

三条命令跑起来，你就有了一个有钱包、能收单、能对账、还能让 AI 帮你管钱的完整系统。

```bash
git clone https://github.com/x33834/KeBaiPay.git && cd KeBaiPay
cp .env.example .env && docker compose -f docker-compose.dev.yml up -d
npm install && npx prisma migrate deploy && npx prisma db seed && npm run start:dev
```

打开 <http://localhost:3001>。测试账号 `13800000001` / `Abc12345`（余额 10000 元，支付密码 `123456`），管理后台 <http://localhost:3001/admin> 用 `admin` / `ChangeAdmin2026`。

> 国内拉取慢？把第一行换成 GitCode 或 Gitee 镜像，见 [镜像仓库](#-镜像仓库)。

---

## 🎯 它能做什么

| 你是谁 | 你能拿走什么 |
|---|---|
| **想搞懂支付系统的工程师** | 资金链路的完整范本：Redis 分布式锁（看门狗续期）→ 事务 → 条件原子更新 → 幂等键唯一约束，四层并发防御；借贷强制平衡的复式记账；防篡改审计哈希链 |
| **需要收款能力的独立开发者** | 微信/支付宝/mock 四渠道连接器、HMAC 开放 API、零依赖 Node SDK、开箱即用的收银台与收款码 |
| **在探索 Agentic Payments 的团队** | 内置 MCP Server，让 Claude / Cursor 安全地替你操作资金：scope 授权 + 限额 + 二次确认 + 全链路审计 |

### 核心能力

- **资金安全工程** — 提现两阶段提交 + 超时扫描核对，进程崩溃也不会双份到账；分账累计超额校验、批量转账崩溃恢复，边界情况都写了测试
- **复式记账 + 审计哈希链** — 借贷不平直接回滚；管理操作全量上链，用 `pg_advisory_xact_lock` 防分叉
- **密钥治理** — 渠道凭据 AES-256-GCM 信封加密落库，`appSecret` 只存 SHA-256，敏感字段按字段名白名单脱敏
- **双抽象渠道层** — PaymentChannel（官方 SDK）+ Connector 路由（重试幂等门控），接新渠道只需实现接口
- **开放 API 对标商用网关** — HMAC-SHA256 + 时间窗 + nonce 防重放 + `timingSafeEqual` + Webhook 指数退避 + SSRF 加固
- **多渠道对账聚合** — 自动拉单 → 匹配 → 差异工作流 → CSV 导出
- **AI Agent 层** — Vercel AI SDK 接任意 OpenAI 兼容模型，内置 MCP Server 与独立 stdio 进程两种形态
- **可观测性** — Prometheus `/metrics`、OpenTelemetry 零开销接入、结构化日志 traceId 全链路

---

## 🖼 界面预览

![showcase](demo/videos/showcase-preview.gif)

<details open>
<summary><b>管理后台 Admin（10 页）</b></summary>

| 数据概览 | 用户管理 | 商户管理 |
|---|---|---|
| ![dashboard](demo/screenshots/admin-dashboard.png) | ![users](demo/screenshots/admin-users.png) | ![merchants](demo/screenshots/admin-merchants.png) |
| 实名审核 | 提现审核 | 支付订单 |
| ![review](demo/screenshots/admin-review-withdrawals.png) | ![withdrawals](demo/screenshots/admin-withdrawals.png) | ![orders](demo/screenshots/admin-orders.png) |
| 财务总览 | 风控事件 | 智能体管理 |
| ![finance](demo/screenshots/admin-finance.png) | ![risk](demo/screenshots/admin-risk.png) | ![agents](demo/screenshots/admin-agents.png) |

</details>

<details>
<summary><b>用户端 H5（7 页）</b></summary>

| 钱包首页 | 充值 | 红包 |
|---|---|---|
| ![home](demo/screenshots/h5-home.png) | ![recharge](demo/screenshots/h5-recharge.png) | ![redpacket](demo/screenshots/h5-redpacket.png) |
| 账单 | 收银台 | AI 助手 |
| ![bills](demo/screenshots/h5-bills.png) | ![cashier](demo/screenshots/h5-cashier.png) | ![agent](demo/screenshots/h5-agent.png) |

</details>

<details>
<summary><b>商户门户 Portal（8 页）</b></summary>

| 数据看板 | 应用密钥 | 订单管理 |
|---|---|---|
| ![dashboard](demo/screenshots/portal-dashboard.png) | ![apps](demo/screenshots/portal-apps.png) | ![orders](demo/screenshots/portal-orders.png) |
| 收款码 | 对账查询 | 商户资料 |
| ![qrcodes](demo/screenshots/portal-qrcodes.png) | ![recon](demo/screenshots/portal-reconciliation.png) | ![merchant](demo/screenshots/portal-merchant.png) |

</details>

---

## 💡 为什么值得一看

市面上支付相关的开源项目，要么是 SDK 封装（只解决"怎么调接口"），要么是电商系统的一个支付模块（只解决"怎么跳收银台"）。**真正把账本、对账、风控、密钥治理讲清楚的，很少。**

这个项目里几个可能对你有参考价值的地方：

- **并发防御是分层的，不是靠一把锁打天下** — 锁解决并发进入，条件原子更新解决并发写入，幂等键唯一约束解决重试，事务隔离解决中间态。四层各自解决不同问题，改任何一层都有测试兜底。
- **复式记账是强制的** — 借贷不平衡直接回滚。很多系统的"账"其实只是一张流水表，对不上账时无从查起。
- **审计链是防篡改的** — 每条日志带前序哈希，用数据库 advisory lock 防分叉。改一条日志，后面全断。
- **AI 花钱是有闸门的** — MCP 工具不是"AI 想干嘛干嘛"，而是 scope 授权 + 单笔/日限额 + 资金操作二次确认，每次调用都进审计链。

也有没做完的地方，不藏着：**Stripe / 银联 Connector 目前是骨架**，测试覆盖率 53% 未达项目自设的 80% 门槛（[体检报告](docs/CODE_HEALTH_REPORT.md) 里有详细分析）。这两个是接下来的重点。

---

## 📊 功能矩阵

| 能力域 | 状态 | 能力域 | 状态 |
|---|---|---|---|
| 钱包 充值/转账/提现/账单 | ✅ | 多渠道对账聚合 | ✅ |
| 红包（拼手气/普通/专属/口令） | ✅ | 担保交易 Escrow | ✅ |
| 商户入驻/应用/Webhook 重试 | ✅ | 批量转账 + 崩溃恢复 | ✅ |
| 开放 API + 零依赖 Node SDK | ✅ | 订阅计费 / 分账 | ✅ |
| 微信/支付宝官方 SDK 直连 | ✅ | 优惠券 / 邀请返现 / 发票 | ✅ |
| AI Agent + MCP + 二次确认 | ✅ | Stripe / 银联 Connector | 🚧 骨架 |
| KYC 双端 UI / 渠道配置中心 | ✅ | 小程序 SDK / 多币种 | 📋 规划中 |

---

## 📚 文档

| 入门 | 深入 | 运维 |
|---|---|---|
| [快速开始](docs/QUICKSTART.md) | [开发指南](docs/DEVELOPER_GUIDE.md) | [生产部署](docs/DEPLOYMENT.md) |
| [API 参考](docs/API_REFERENCE.md) | [专家评审与路线图](docs/EXPERT_PANEL_ASSESSMENT.md) | [上线检查清单](docs/PRODUCTION_READINESS.md) |
| [SDK 指南](docs/SDK_GUIDE.md) | [代码健康报告](docs/CODE_HEALTH_REPORT.md) | [故障排查](docs/TROUBLESHOOT.md) |
| [用户手册](docs/USER_MANUAL.md) | [版本管理规范](docs/VERSIONING.md) | [更新日志](docs/CHANGELOG.md) |

- 完整 OpenAPI 3.0 规范（220 个端点）：[`docs/openapi.json`](docs/openapi.json)
- 商户 5 步接入第一笔收款：见 [QUICKSTART](docs/QUICKSTART.md)

---

## 🌏 镜像仓库

三平台同步维护，任选一个：

| 平台 | 地址 | 说明 |
|---|---|---|
| GitHub | [x33834/KeBaiPay](https://github.com/x33834/KeBaiPay) | 主仓库，Issue / PR 入口 |
| GitCode | [badhope/KeBaiPay](https://gitcode.com/badhope/KeBaiPay) | 国内镜像 |
| Gitee | [badhope/KeBaiPay](https://gitee.com/badhope/KeBaiPay) | 国内镜像 |

---

## 🤝 参与贡献

提 PR 前请确保 `npm run lint && npx jest --maxWorkers=4` 全绿。发版遵循 [SemVer 纪律](docs/VERSIONING.md)，贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

安全漏洞请走 [SECURITY.md](SECURITY.md) 私下披露，不要开公开 issue。

---

## ⚠️ 关于合规

代码是 MIT 的，随便用。但**系统含平台内账本，在中国大陆实际运营涉及无证支付业务与"二清"红线**——这是运营资质问题，不是许可证能解决的。默认只启用 mock 渠道，想违规营业都跑不起来。

生产部署前请读 [合规分析](docs/EXPERT_PANEL_ASSESSMENT.md) 与 [上线清单](docs/PRODUCTION_READINESS.md)。

---

## 📄 许可证

[MIT](LICENSE) — 自由使用、修改、分发，包括商业用途。

---

<div align="center">

如果这个项目帮你省下了几个通宵，或者让你终于搞懂了某段资金链路，**点个 Star ⭐ 就是最好的反馈**。

也欢迎把它分享给可能需要的朋友——好东西被看见，才有继续维护的动力。

<sub>Built with care by KeBaiPay Contributors · v0.3.0</sub>

</div>
