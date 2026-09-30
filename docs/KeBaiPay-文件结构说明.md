# KeBaiPay 文件结构说明（合规聚合模式 · 最终版）

> 版本：V2.0 ｜ 对应改造后代码（资金池模块已全部删除）
> 运行模式：**合规聚合技术服务商**——平台不持有资金，收单走持牌通道，退款原路退回。

## 一、项目概览

- 技术栈：NestJS 11 + TypeScript + Prisma 7 + PostgreSQL 16 + Redis 7 + Vue3/Vite/Element Plus + Vercel AI SDK
- 后端端口 3001，Swagger `/api/docs`（仅非生产）
- 当前 src 共 **25 个业务/基础设施目录**，全部服务于收单、对账、风控、商户、管理链路

## 二、后端模块清单（src/）

### 收单核心域
| 目录 | 职责 | 关键文件 |
|---|---|---|
| `cashier` | 收银台：创建订单、**渠道支付**（channel-pay）、订单查询/导出、订单级对账、收款码信息 | service（createChannelPay）、dto/pay-channel-order.dto |
| `payment-channels` | 渠道抽象层：微信/支付宝/mock 双通道 + Connector 体系；**统一退款服务**（退款单内嵌订单） | payment-channel.registry、refund.service、channels/、connectors/ |
| `webhooks` | 收单回调：验签→查单→终态幂等→渠道/金额一致→置 PAID→通知商户 | webhooks.service（已重写） |
| `qr-codes` | 收款码管理（个人/固定金额）；扫码付款已下线，仅作收单入口 | qr-codes.service |

### 商户与开放能力
| 目录 | 职责 |
|---|---|
| `merchants` | 商户入驻、资质审核、结算账户、费率/限额配置 |
| `open-api` | 商户开放 API：创建订单/查询/退款/**收单统计**（原转账/余额已下线） |
| `invoices` | 发票申请/开具/取消 |
| `coupons` | 优惠券发布/领取/核销（商户营销，不涉平台资金） |

### 账户与用户
| 目录 | 职责 |
|---|---|
| `users` | 用户注册/登录信息、实名状态（注册不再创建平台账户） |
| `auth` | JWT 认证、登录态 |
| `bills` | 账单（改为「我作为付款方的收单订单」维度） |

### 财务与对账
| 目录 | 职责 | 关键文件 |
|---|---|---|
| `finance` | 财务日报（订单维度：收单金额/手续费/退款）、**订单级对账**、日报快照 | finance.service、reconciliation.service |

### 风控与安全
| 目录 | 职责 |
|---|---|
| `risk` | 风控引擎（频率/额度按收单订单统计）、风险事件、规则 |
| `security` | 安全工具（防注入/校验） |
| `crypto` | AES-256-GCM 加密、哈希、脱敏 |
| `audit` | 审计日志、哈希链防篡改 |

### 管理与运营
| 目录 | 职责 |
|---|---|
| `admin` | 管理后台：用户/商户/订单/风控/渠道/系统配置/审计（提现审核、调账已下线） |
| `agent` | AI 智能体：MCP 工具（查订单/商户统计）、授权、对话（转账工具已下线） |
| `messages` | 站内信 |
| `notifications` | 通知发送（被其他模块调用） |
| `sms` | 短信验证码 |

### 基础设施
| 目录 | 职责 |
|---|---|
| `prisma` | PrismaService 封装 |
| `redis` | Redis 客户端、分布式锁（withLock）、滑动窗口 |
| `health` | 健康检查（liveness/readiness/schedules）与 Prometheus `/metrics` 指标（metrics.controller/metrics.service 在本目录内） |
| `common` | 常量、错误码（kbError）、枚举、日期/金额工具、CSV |
| `app.module.ts` | 根模块（资金池模块已摘除并注释原因） |
| `main.ts` / `tracing.ts` | 启动入口 / 链路追踪 |

## 三、数据模型（prisma/schema.prisma）

保留模型：User、Merchant、IdentityVerification、QrCode、MerchantApp、PaymentOrder、AdminUser、LoginLog、RiskEvent、DailySnapshot、DailyLimitUsage、ReconciliationReport、ChannelBillCheck、SystemConfig、AdminOperationLog、WebhookLog、PaymentChannelConfig、Coupon、UserCoupon、Message、MessageRead、Invoice、Agent、AgentAuthorization、AgentOperationLog、AgentConversation、AgentMessage

- **PaymentOrder（核心）**：含收单渠道（channel/channelOrderNo）与退款单内嵌字段（refundNo/refundStatus/refundChannelNo/refundIdempotencyKey/refundPendingAmount）
- 已删除模型（20 个）：Account、AccountLedger、TransactionOrder、Bill、WithdrawalOrder、RedPacket、RedPacketRecord、AdjustmentApproval、PlatformAccount、EscrowOrder、BatchTransfer、BatchTransferItem、SubscriptionPlan、Subscription、SubscriptionCharge、SplitOrder、SplitItem、ReferralCode、Referral、BankCard

## 四、数据库迁移（prisma/migrations）

| 迁移 | 内容 |
|---|---|
| `20260930000000_add_payment_order_channel` | payment_orders 加 channel / channel_order_no |
| `20260930010000_compliance_pool_removal` | payment_orders 加退款字段；DROP 20 张资金池表 + bank_cards |
| `20260930020000_channel_bill_check` | 新增 channel_bill_checks 通道账单核对记录表（按 日期+通道 唯一） |
| `20260930030000_compliance_residual_cleanup` | 删 merchants.withdraw_rate 列、journal_entries 表及 6 张孤儿表 |
| `20260930040000_drop_channel_type` | DROP payment_channel_configs.type 列（聚合模式纯收单，type 无业务语义） |

> 其余历史迁移（20260704 ~ 20260922）随仓库保留；部署时 `prisma migrate deploy` 全部按序执行。

部署：`npx prisma migrate deploy`

## 五、前端三端

| 端 | 说明 |
|---|---|
| `web`（商户端） | 商户入驻、应用、订单、收款码、对账（本就订单维度，未动） |
| `web-h5`（C 端） | 首页（收单统计）、账单、**收银台（支付宝/微信渠道支付）**、实名、AI 助手；充值/提现/转账/红包页已删 |
| `web-admin`（管理端） | 数据概览、用户/商户/订单/渠道/财务/风控/智能体；提现审核页已删 |

## 六、已删除清单（合规下线）

- 模块目录 11 个：accounts、transactions、withdrawals、transfers、red-packets、escrow、batch-transfers、splits、subscriptions、referrals、bank-cards
- 死代码：admin 调账/提现方法、cashier 旧余额支付、open-api 旧转账/余额、qr-codes 扫码付款、journal 复式记账服务、7 个死 DTO
- 数据表 20 张（见迁移）

## 七、改造要点（合规）

1. **资金不过平台**：无余额/充值/提现/转账/红包/担保，资金由持牌通道直接清算
2. **收单链路**：createChannelPay → 持牌通道收银台 → webhooks 回调确认 → 通知商户
3. **退款**：退款单内嵌 PaymentOrder，通道原路退回，平台只更新订单状态
4. **对账**：订单维度（快照核对 + 通道账单待接入）
5. 详见 `docs/COMPLIANCE_MODE.md`
