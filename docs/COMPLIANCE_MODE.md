# 合规聚合模式（Compliance Mode）

> 本文件描述 KeBaiPay 的**合规聚合技术服务模式**改造：平台不持有用户资金、
> 不提供支付账户余额，资金全程由持牌支付机构清算。本模式是当前默认运行模式。

## 1. 模式定义

**聚合支付技术服务商（Aggregator / Payment Facilitation Service）**：

- 平台负责：商户入网审核、交易订单管理、对账报表、风控辅助、AI 运营工具；
- 资金链路：付款方 → 持牌支付机构（微信支付 / 支付宝等）→ 商户结算账户；
- 平台**不经手、不沉淀、不转付**任何资金，也没有"平台余额"概念。

**与"二清"的本质区别**：资金从付款方直达持牌机构清算账户，由持牌机构按
T+1 结算给商户，平台不截留、不中转资金。任何"平台内余额 → 提现/转账"的
资金池模式都是无证从事支付业务的监管红线（《非银行支付机构监督管理条例》
2024-05-01 施行，第 47 条对无证经营设有罚则）。

## 2. 已下线：资金池模块

以下 10 个模块已从 `src/app.module.ts` 摘除，**代码目录、DTO、数据表已物理删除**（迁移 `20260930010000_compliance_pool_removal`）：

| 模块 | 原能力 | 下线原因 |
|---|---|---|
| `accounts` | 用户余额账户 | 平台不设余额 |
| `transactions` | 充值/转账流水 | 资金不经平台 |
| `withdrawals` | 提现 | 商户结算由持牌机构完成 |
| `transfers` | 站内转账 | 资金不经平台 |
| `red-packets` | 红包 | 资金不经平台 |
| `escrow` | 担保交易 | 资金不经平台 |
| `batch-transfers` | 批量转账 | 资金不经平台 |
| `splits` | 任务分账 | 分账应使用持牌通道侧分账能力 |
| `subscriptions` | 订阅自动扣费 | 扣费为平台内划转，需持牌机构签约代扣 |
| `referrals` | 邀请返利 | 返利入平台余额，应由商户结算侧完成 |

同时下线/改造的耦合点：

- `admin`：提现审核三端点、人工调账四端点（`accounts/:userId/adjust`、
  `adjustments/*`）已移除，对应方法体/DTO 已删除；仪表盘统计口径改为收单订单；
- `agent`（AI 智能体）：`kbpay_transfer` 工具已删除，改为查询订单/商户收单统计；
- `webhooks`：充值/代付回调改为**收单回调**（确认 PaymentOrder 支付结果）；
- `open-api`：`POST /transfers`、`GET /balance` 端点移除，新增
  `GET /stats`（商户收单统计）；
- `cashier`：余额支付路由移除，新增渠道收单支付（见下）；
- `qr-codes`：扫码付款（余额划转）端点下线，收款码仅作收单入口；
- `refund`：退款单**内嵌于收单订单**（refundNo/refundStatus/refundChannelNo/refundPendingAmount），
  退款由持牌通道**原路退回**，平台不再扣平台余额、不设退款流水表；
- `bills` / `finance` / `reconciliation`：全部改为订单维度口径；
- `risk`：风控频率/额度统计改为按收单订单（payerId + 支付状态）；
- `users` / `admin`：注册不再创建平台账户，用户详情不再返回余额；
- 复式记账服务（journal）已删除（无账户即无记账对象）。

## 3. 收单链路（新增）

```
商户/用户创建订单
   └─ POST /cashier/orders（CreateCashierOrderDto）
        └─ POST /cashier/orders/:orderNo/channel-pay
             { channel: 'alipay'|'wechat'|'mock', payMethod?, clientIp? }
             ├─ 校验：订单/商户状态/实名/风控 → 渠道可用性
             ├─ 原子绑定渠道 → 调 channel.createRecharge
             ├─ 持久化 channelOrderNo → 返回 payUrl / payParams
             └─ 用户跳转持牌通道收银台完成支付
持牌通道异步回调
   └─ POST /webhooks/recharge（验签 → 查单 → 终态幂等 → 渠道一致/金额一致校验
        → PaymentOrder 置 PAID + channelOrderNo → 通知商户）
```

- 渠道抽象层保持原 `payment-channel.registry` 双通道设计（微信/支付宝/mock）；
- 生产环境禁 mock 的保护逻辑未动；
- 渠道配置见 `docs/PAYMENT_CHANNEL_CONFIG.md`；
- 收单回调地址由环境变量 `CHANNEL_NOTIFY_URL` 决定（默认
  `<CASHIER_BASE_URL>/webhooks/recharge`），`createChannelPay` 按渠道拼接。

## 4. 对账口径（订单维度）

- 平台资产恒为 0（`totalAssets = 0`），不再有账本余额核对；
- 日报快照 `finance.getDailySummary`：统计当日**收单订单**成功金额/手续费/退款；
- 对账 `reconciliation`：系统内核对（快照 vs 订单统计）+ 通道账单逐笔核对
  （已实现：模拟账单演练现可运行，接口
  `POST /admin/reconciliation/channel-bill/generate|reconcile`；记录表
  `channel_bill_checks`，按 日期+通道 唯一；接入持牌通道商户号后以官方账单
  替换模拟来源即可，核对链路无需改动）；
- 商户对账（`/cashier/orders/reconciliation`）与开放 API `stats` 同为订单维度。

## 5. 前端收敛

| 端 | 变更 |
|---|---|
| `web-h5`（C 端） | 删除充值/提现/转账/红包页；首页改为收单首页（账单统计）；收银台改为支付宝/微信渠道支付 |
| `web-admin`（管理） | 删除提现审核页/菜单；仪表盘移除"待处理提现"卡；用户详情不再展示余额 |
| `web`（商户端） | 保持订单/对账维度（本来就无钱包功能） |

## 6. 部署注意事项

1. **数据库迁移**：`PaymentOrder` 新增 `channel`、`channelOrderNo` 字段，
   部署时执行 `npx prisma migrate deploy`（迁移文件
   `prisma/migrations/20260930000000_add_payment_order_channel/`）；
2. **环境变量**：`DATABASE_URL`、`REDIS_URL` 必填；`CHANNEL_NOTIFY_URL` 改为
   实际可公网访问的回调地址（渠道回调必须公网可达）；
3. **渠道配置**：在管理后台「渠道配置」录入持牌通道（微信/支付宝）商户号与证书，
   测试环境可用 `mock` 渠道；
4. **测试账号**：`13800000001` / `Abc12345`（用户）、`admin` / `ChangeAdmin2026`（管理端）；
5. **上线前核对**：商户入网审核流程、风控规则、对账任务（日报快照）与
   通道账单匹配项均已就绪后，方可接入真实商户。

## 7. 已删除的数据表

| 表 | 说明 |
|---|---|
| accounts / account_ledgers | 平台账户与账本 |
| transaction_orders | 平台内交易流水（退款单已内嵌 payment_orders） |
| bills | 资金账单（账单改为收单订单维度） |
| withdrawal_orders | 提现 |
| red_packets / red_packet_records | 红包 |
| escrow_orders | 担保交易 |
| batch_transfers / batch_transfer_items | 批量转账 |
| subscription_plans / subscriptions / subscription_charges | 订阅 |
| split_orders / split_items | 分账 |
| referral_codes / referrals | 邀请返利 |
| platform_accounts | 平台资金账户 |
| adjustment_approvals | 调账审批 |
| bank_cards | 绑卡（银行卡管理） |

> 数据库结构以迁移 `20260930000000_add_payment_order_channel` +
> `20260930010000_compliance_pool_removal` 为准，部署时 `prisma migrate deploy` 执行。

## 8. 法律文本

`docs/legal/*` 已同步改写为聚合服务模式表述（无"钱包/余额/充值/提现"表述），
请由法务复核后使用。
