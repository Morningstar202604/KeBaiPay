# KeBaiPay API 参考文档

> 版本：V3.0（合规聚合模式）｜ 由当前代码自动生成，共 136 个操作 / 121 条路径，覆盖 16 个模块
> 机器可读定义见 `docs/openapi.json`；运行时以 Swagger `/api/docs` 为准

## 认证方式
- 用户端：JWT Bearer（`user-auth`）
- 管理端：JWT Bearer（`admin-auth`）
- 商户开放 API：HMAC-SHA256 签名（`app-id` 头）

## 端点列表

### 1. auth

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `auth/login` | 用户登录 |
| POST | `auth/register` | 用户注册 |

### 2. users

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `users/bind-email` | 绑定/换绑邮箱 |
| POST | `users/bind-phone` | 绑定/换绑手机号 |
| POST | `users/change-password` | 修改登录密码 |
| GET | `users/login-logs` | 查询登录日志 |
| GET | `users/me` | 获取当前用户信息 |
| PATCH | `users/me` | 更新当前用户资料 |
| POST | `users/reset-pay-password` | 重置支付密码 |
| POST | `users/verify-identity` | 提交实名认证 |

### 3. bills

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `bills` | 查询账单列表 |

### 4. cashier

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `cashier/orders` | 创建收银台订单 |
| GET | `cashier/orders` | 查询我的收银台订单 |
| GET | `cashier/orders/:orderNo` | 查询订单详情 |
| POST | `cashier/orders/:orderNo/channel-pay` | 发起渠道支付并返回支付凭证 |
| POST | `cashier/orders/:orderNo/notify` | 重试回调通知 |
| GET | `cashier/orders/export` | 导出订单 CSV |
| GET | `cashier/orders/reconciliation` | 对账查询 |
| GET | `cashier/qrcode/:code` | 扫码获取收款码信息 |

### 5. qr-codes

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `qr-codes/fixed` | 创建固定金额收款码 |
| GET | `qr-codes/personal` | 获取个人收款码 |

### 6. merchants

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `merchants/apps` | 创建商户应用 |
| GET | `merchants/apps` | 列出商户所有应用 |
| PATCH | `merchants/apps/:appId` | 更新商户应用设置 |
| POST | `merchants/apps/:appId/regenerate-secret` | 重新生成应用密钥 |
| GET | `merchants/dashboard` | 商户数据看板 |
| GET | `merchants/me` | 获取当前商户信息 |
| PATCH | `merchants/me` | 更新商户资料 |
| POST | `merchants/qrcodes` | 创建商户收款码 |
| GET | `merchants/qrcodes` | 列出商户收款码 |
| DELETE | `merchants/qrcodes/:id` | 删除商户收款码 |
| POST | `merchants/register` | 商户入驻申请 |

### 7. open-api

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `open-api/v1/orders` | 创建收款订单 |
| GET | `open-api/v1/orders/:orderNo` | 查询订单详情 |
| POST | `open-api/v1/refunds` | 申请退款 |
| GET | `open-api/v1/stats` | 查询商户收单统计 |

### 8. invoices

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/invoices` | 管理员查询所有发票列表 |
| GET | `/admin/invoices/:invoiceNo` | 管理员查询发票详情 |
| POST | `/admin/invoices/:invoiceNo/cancel` | 管理员作废发票 |
| POST | `/admin/invoices/:invoiceNo/issue` | 管理员开具发票 |
| POST | `/invoices` | 商户申请发票 |
| GET | `/invoices` | 商户查询自己的发票列表 |
| GET | `/invoices/:invoiceNo` | 查询发票详情 |
| POST | `/invoices/:invoiceNo/cancel` | 商户作废自己的发票（仅 PENDING 状态） |

### 9. coupons

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `coupons` | 创建优惠券 |
| GET | `coupons` | 列出我创建的优惠券 |
| GET | `coupons/:couponNo` | 查询优惠券详情 |
| POST | `coupons/:couponNo/claim` | 领取优惠券 |
| PUT | `coupons/:couponNo/status` | 启用/禁用优惠券 |
| GET | `coupons/mine/:userCouponNo` | 查询用户优惠券详情 |
| GET | `coupons/mine/list` | 列出我领取的优惠券 |

### 10. messages

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `messages` | 我的消息列表（含广播+定向，带已读标记） |
| GET | `messages/:messageNo` | 消息详情 |
| POST | `messages/:messageNo/delete` | 删除定向消息（广播不可删） |
| POST | `messages/:messageNo/read` | 标记消息已读 |
| POST | `messages/read/all` | 一键全部已读 |
| GET | `messages/unread/count` | 我的未读消息数量 |

### 11. agent

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `agent/admin/agents` | 创建 Agent（管理端） |
| GET | `agent/admin/agents` | 列出所有 Agent（管理端） |
| PATCH | `agent/admin/agents/:id` | 更新 Agent（管理端：名称/描述/状态/作用域） |
| POST | `agent/admin/agents/:id/rotate-secret` | 轮换 Agent 密钥（管理端，新密钥仅本次响应返回一次） |
| GET | `agent/authorizations` | 查询我的授权列表 |
| POST | `agent/authorize` | 用户授权 Agent 代为操作 |
| POST | `agent/chat` | 发送消息并获取 AI 回复（核心入口） |
| POST | `agent/confirm` | 确认或拒绝待确认的 Agent 操作 |
| POST | `agent/conversations` | 创建会话 |
| GET | `agent/conversations` | 查询我的会话列表 |
| POST | `agent/conversations/:id/close` | 关闭会话 |
| GET | `agent/conversations/:id/messages` | 查询会话历史消息 |
| POST | `agent/login` | 用户换取 Agent 访问令牌 |
| GET | `agent/me/agents` | 列出当前用户可用的 Agent 及授权状态 |
| POST | `agent/revoke/:authId` | 撤销授权（仅限本人授权） |

### 12. webhooks

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `webhooks/recharge/:channel` | 收单支付回调 |
| POST | `webhooks/refund/:channel` | 退款回调 |

### 13. admin

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `admin/admin-users` | 管理员列表 |
| POST | `admin/admin-users` | 创建管理员 |
| PUT | `admin/admin-users/:id` | 更新管理员信息 |
| DELETE | `admin/admin-users/:id` | 删除管理员 |
| POST | `admin/admin-users/:id/reset-password` | 重置管理员密码 |
| GET | `admin/audit-logs` | 操作审计日志 |
| POST | `admin/auth/change-password` | 修改管理员密码 |
| POST | `admin/auth/login` | 管理员登录 |
| GET | `admin/channels` | 支付渠道列表 |
| POST | `admin/channels` | 创建支付渠道 |
| PUT | `admin/channels/:code` | 更新支付渠道 |
| DELETE | `admin/channels/:code` | 删除支付渠道 |
| POST | `admin/channels/:code/test` | 测试支付渠道 |
| GET | `admin/dashboard` | 管理后台数据概览 |
| POST | `admin/identity/:id/approve` | 通过实名认证 |
| POST | `admin/identity/:id/reject` | 拒绝实名认证 |
| GET | `admin/identity/pending` | 待审核实名列表 |
| GET | `admin/login-logs` | 登录日志 |
| GET | `admin/merchants` | 商户列表 |
| POST | `admin/merchants/:id/audit` | 审核商户 |
| POST | `admin/merchants/:id/config` | 修改商户配置 |
| GET | `admin/payment-orders` | 支付订单列表 |
| GET | `admin/risk-events` | 风控事件列表 |
| POST | `admin/risk-events/:id/handle` | 处理风控事件 |
| GET | `admin/risk-rules` | 获取风控规则 |
| PUT | `admin/risk-rules/:code` | 更新风控规则 |
| GET | `admin/system-config` | 获取所有系统配置 |
| POST | `admin/system-config` | 创建系统配置 |
| GET | `admin/system-config/:key` | 获取指定配置项 |
| PUT | `admin/system-config/:key` | 更新系统配置 |
| GET | `admin/users` | 用户列表 |
| GET | `admin/users/:id` | 用户详情 |
| POST | `admin/users/:id/risk-level` | 修改用户风控等级 |
| POST | `admin/users/:id/status` | 修改用户状态 |

### 14. finance

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `admin/finance/daily-snapshots` | 每日资产快照 |
| GET | `admin/finance/daily-summary` | 每日收支汇总 |
| GET | `admin/finance/daily-summary/export` | 导出每日汇总 CSV |
| GET | `admin/finance/fee-income` | 手续费收入统计 |
| GET | `admin/finance/fee-income/export` | 导出手续费 CSV |
| GET | `admin/finance/merchant-settlements` | 商户结算明细 |
| GET | `admin/finance/merchant-settlements/export` | 导出商户结算 CSV |
| GET | `admin/finance/overview` | 财务概览 |
| POST | `admin/finance/settlement/run` | 手动执行结算 |
| GET | `admin/finance/settlement/unfinished` | 未结算订单汇总 |
| GET | `admin/finance/snapshots/export` | 导出资产快照 CSV |
| POST | `admin/finance/snapshots/generate` | 手动生成每日快照 |
| GET | `admin/reconciliation/channel-bill/checks` | 通道账单核对记录列表 |
| POST | `admin/reconciliation/channel-bill/generate` | 生成模拟通道账单 |
| POST | `admin/reconciliation/channel-bill/reconcile` | 执行通道账单核对 |
| GET | `admin/reconciliation/reports` | 对账报告列表 |
| GET | `admin/reconciliation/reports/:date` | 查询指定日期对账报告 |
| GET | `admin/reconciliation/reports/export` | 导出对账报告 CSV |
| POST | `admin/reconciliation/run` | 执行对账 |

### 15. sms

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `sms/config` | 查询短信配置 |
| POST | `sms/send` | 发送短信验证码 |
| POST | `sms/verify` | 校验短信验证码 |

### 16. health

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `health` | 存活探针（liveness） |
| GET | `health/channels` | 支付渠道状态（管理员）：已注册渠道及其启用配置 |
| GET | `health/channels/summary` | 支付渠道状态摘要（管理员） |
| GET | `health/ready` | 就绪探针（readiness），检查 DB 与 Redis |
| GET | `health/schedules` | 调度任务健康状态（管理员） |
| GET | `metrics` | Prometheus 指标（供 Prometheus server 抓取） |
