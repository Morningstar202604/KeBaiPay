# KeBaiPay 商户手册

> 适用版本：v0.3.5（合规聚合模式）
> 本平台**不提供**：余额、充值、提现、转账、红包、分账、担保、批量代付、订阅、邀请返现、绑卡。
> 本平台**提供**：商户入网、持牌通道收单、退款原路退回、渠道账单对账、开放 API、收款码、优惠券、发票。

---

## 1. 接入总览

商户接入 KeBaiPay 的标准流程：

1. 注册用户账号 + 实名认证
2. 提交商户入驻申请 → 平台审核
3. 创建商户应用 → 拿到 `appId` / `appSecret`
4. 服务端通过开放 API 创建收单订单
5. 浏览器跳收银台 → 用户在持牌渠道完成支付
6. 接收 Webhook 收单回调
7. 日常对账：开放 API 查单、管理后台对账、CSV 导出

资金清算由持牌支付机构直接完成，平台不经手商户与用户资金。

---

## 2. 认证

### 2.1 用户端 JWT

用于商户门户（H5/Portal）操作：入驻、应用管理、收款码、看板。

```http
POST /auth/login
{ "phone": "13800000000", "password": "..." }
```

### 2.2 开放 API HMAC-SHA256 签名

用于服务端调用 `/open-api/v1/*`：

| Header | 说明 |
|---|---|
| `X-App-Id` | 创建应用时返回的 AppId |
| `X-Timestamp` | Unix 秒，与服务器时间差超过 5 分钟拒绝 |
| `X-Nonce` | 随机串，5 分钟内防重放 |
| `X-Signature` | `HMAC-SHA256(appSecret, timestamp + nonce + body)` 的 hex |

---

## 3. 收单核心接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/open-api/v1/orders` | 创建收单订单，返回 `cashierUrl` |
| GET | `/open-api/v1/orders/:orderNo` | 查询订单详情 |
| POST | `/open-api/v1/refunds` | 申请退款（原路退回） |
| GET | `/open-api/v1/stats` | 查询商户收单统计（笔数/金额/手续费/退款） |

### 3.1 创建订单请求体

```json
{
  "outOrderNo": "M202609300001",
  "amount": 0.01,
  "subject": "测试商品",
  "body": "商品描述",
  "notifyUrl": "https://your-domain.com/webhook/kebai",
  "expireMinutes": 30
}
```

### 3.2 订单状态机

`PENDING` → `PAID`（渠道支付成功回调）；`PENDING` → `CLOSED`（超时/取消）；`PAID` → `REFUNDING` → `REFUNDED` / `PARTIAL_REFUNDED`。

---

## 4. Webhook 回调

### 4.1 事件类型

| eventType | 触发时机 |
|---|---|
| `ORDER_PAID` | 收单订单支付成功 |
| `ORDER_CLOSED` | 订单超时关闭 |
| `REFUND_NOTIFY` | 退款完成（全额/部分） |

### 4.2 验签与幂等

1. 校验 `X-KB-Signature`（HMAC-SHA256 with appSecret）
2. 校验金额与你下单时完全一致（fail-closed）
3. 以 `outOrderNo` / `refundNo` 做幂等处理
4. 处理成功返回 HTTP 200；否则平台按指数退避重试（最多 8 次）

---

## 5. 对账

### 5.1 每日对账

- 平台每日凌晨自动拉取渠道官方账单
- 与平台收单订单逐笔匹配
- 差异进入 `/admin/reconciliation/reports` 工作流
- 商户可在门户「对账查询」页按日期导出 CSV

### 5.2 商户侧对账动作

1. 每日拉取平台 CSV 或调用开放 API 查单
2. 与你自己的业务订单库比对
3. 差异在 24 小时内提交平台客服工单

---

## 6. 收款码

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/merchants/qrcodes` | 创建固定/自定义金额收款码 |
| GET | `/merchants/qrcodes` | 列出收款码 |
| DELETE | `/merchants/qrcodes/:id` | 删除收款码 |

用户扫码 → 进入收银台 → 渠道支付。

---

## 7. 优惠券

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/coupons` | 创建优惠券（商户侧） |
| GET | `/coupons` | 列出我创建的优惠券 |
| GET | `/coupons/:couponNo` | 优惠券详情 |
| PUT | `/coupons/:couponNo/status` | 启用/禁用 |

> 用户领取与使用为 C 端能力；平台不涉及红包、返现、分销。

---

## 8. 发票

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/invoices` | 商户申请发票 |
| GET | `/invoices` | 发票列表 |
| GET | `/invoices/:invoiceNo` | 发票详情 |
| POST | `/invoices/:invoiceNo/cancel` | 作废（仅 PENDING） |

---

## 9. 错误码

常见错误码以 `KB` 开头，完整列表见 [API_REFERENCE](API_REFERENCE.md)。典型：

| code | 含义 |
|---|---|
| KB401 | 签名验证失败 |
| KB603 | 订单不存在 |
| KB713 | 订单不可退 |
| KB715 | 退款金额无效 |
| KB717 | 应用已禁用 |

---

## 10. 常见问题

| 问题 | 处理 |
|---|---|
| 用户已付款但订单仍 PENDING | 渠道回调可能丢失；平台定时任务 15 分钟内自动查渠道补单；也可在门户手动重查 |
| 退款多久到账 | 原路退回持牌渠道账户，时效由渠道决定（通常 1-3 工作日） |
| 手续费怎么算 | 按商户配置费率计算，在财务总览/结算明细中查看 |
| 平台能帮我代付给下游吗 | 不能。本平台不提供代付/转账/分账能力 |
| 我能在平台给用户发红包吗 | 不能。红包能力已下线 |
| appSecret 泄露 | 门户「应用管理」→「重新生成密钥」，旧密钥立即失效 |
