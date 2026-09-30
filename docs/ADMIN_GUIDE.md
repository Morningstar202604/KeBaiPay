# KeBaiPay 管理后台指南

> 适用版本：v0.3.5（合规聚合模式）
> 管理员职责：商户审核、用户/实名管理、风控处置、渠道配置、收单订单监管、对账监控、AI 智能体管理、系统配置。
> 平台**不设**：提现审核、调账双人复核、转账审批、红包/担保/分账/订阅管理。

---

## 1. 登录与管理员管理

```http
POST /admin/auth/login            # 管理员登录
POST /admin/auth/change-password # 修改密码
GET  /admin/admin-users           # 管理员列表
POST /admin/admin-users           # 创建管理员
PUT  /admin/admin-users/:id       # 更新
DELETE /admin/admin-users/:id    # 删除
POST /admin/admin-users/:id/reset-password
```

权限角色：`SUPER_ADMIN` / `FINANCE` / `OPERATIONS` / `RISK` 等，详见代码 `src/admin/permissions.decorator.ts`。

---

## 2. 数据概览

```http
GET /admin/dashboard
```

平台关键指标：用户数、商户数、今日收单订单、今日金额、待审核商户、待实名审核。

---

## 3. 用户管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/users` | 用户列表 |
| GET | `/admin/users/:id` | 用户详情 |
| POST | `/admin/users/:id/status` | 冻结/解冻 |
| POST | `/admin/users/:id/risk-level` | 修改风控等级 |

---

## 4. 商户管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/merchants` | 商户列表 |
| POST | `/admin/merchants/:id/audit` | 通过/驳回入驻 |
| POST | `/admin/merchants/:id/config` | 配置费率/限额 |

---

## 5. 实名审核

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/identity/pending` | 待审核列表 |
| POST | `/admin/identity/:id/approve` | 通过 |
| POST | `/admin/identity/:id/reject` | 驳回（需原因） |

---

## 6. 收单订单监管

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/payment-orders` | 全平台收单订单 |

支持按商户/状态/时间筛选；可查看回调通知状态并手动重发。

---

## 7. 风控

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/risk-events` | 风控事件列表 |
| POST | `/admin/risk-events/:id/handle` | 人工处置 |
| GET | `/admin/risk-rules` | 风控规则 |
| PUT | `/admin/risk-rules/:code` | 更新规则 |

---

## 8. 渠道配置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/channels` | 渠道列表 |
| POST | `/admin/channels` | 新增渠道 |
| PUT | `/admin/channels/:code` | 更新 |
| DELETE | `/admin/channels/:code` | 删除 |
| POST | `/admin/channels/:code/test` | 测试渠道可用性 |

渠道凭据 AES-256-GCM 加密存储，保存后热同步到连接器运行时。

---

## 9. 财务与对账

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/finance/overview` | 财务概览 |
| GET | `/admin/finance/daily-summary` | 每日汇总 |
| GET | `/admin/finance/merchant-settlements` | 商户结算明细 |
| GET | `/admin/finance/fee-income` | 手续费收入 |
| GET | `/admin/finance/daily-snapshots` | 每日快照 |
| POST | `/admin/finance/snapshots/generate` | 手动生成快照 |
| GET | `/admin/finance/settlement/unfinished` | 未结算订单 |
| POST | `/admin/finance/settlement/run` | 手动执行结算 |
| POST | `/admin/reconciliation/run` | 执行对账 |
| GET | `/admin/reconciliation/reports` | 对账报告 |
| POST | `/admin/reconciliation/channel-bill/generate` | 拉取渠道账单 |
| POST | `/admin/reconciliation/channel-bill/reconcile` | 渠道账单逐笔核对 |
| GET | `/admin/reconciliation/channel-bill/checks` | 核对结果 |

> 结算明细为**商户自有结算账户**维度的信息，平台不经手资金。

---

## 10. 日志与审计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/login-logs` | 登录日志 |
| GET | `/admin/audit-logs` | 操作审计日志（哈希链） |

---

## 11. AI 智能体管理

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/agent/admin/agents` | 创建智能体 |
| GET | `/agent/admin/agents` | 列表 |
| PATCH | `/agent/admin/agents/:id` | 更新 |
| POST | `/agent/admin/agents/:id/rotate-secret` | 轮换密钥 |

---

## 12. 系统配置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/system-config` | 全部配置 |
| GET | `/admin/system-config/:key` | 单项 |
| POST | `/admin/system-config` | 新建 |
| PUT | `/admin/system-config/:key` | 更新 |

---

## 13. 合规红线（管理员必读）

- **不得**在平台内为用户/商户开设余额账户
- **不得**通过平台发起任何资金划转（转账/代付/分账/红包）
- **不得**将平台作为"二清"通道
- 所有资金清算必须通过持牌支付机构原路完成
- 配置渠道时必须使用 AES-256-GCM 加密的凭据，禁止明文落库
