# KeBaiPay 商户 5 分钟快速接入指南

> 本指南面向第一次接入 KeBaiPay 的商户开发者，按步骤走完即可完成一笔真实收单。
> KeBaiPay 是**合规聚合支付技术服务**：平台不设余额/充值/提现/转账/红包/分账/担保，资金由持牌支付机构直接清算。

## 1. 项目介绍

KeBaiPay（科佰支付）提供：商户入网审核、持牌通道收单（微信/支付宝/mock）、开放 API（创建订单、查询订单、申请退款、收单统计）、渠道账单对账、AI 智能体运营助手。本指南带你在 5 分钟内完成「注册 → 实名 → 入驻 → 创建应用 → 服务端集成 → 沙箱测试」全流程，并跑通一笔 1 分钱的收单订单。

---

## 2. 两种接入场景

| 场景 | 适用对象 | 认证方式 | 起步时间 |
|------|----------|----------|----------|
| 商户收银台（B 端页面/扫码） | 商户通过页面/收款码向用户收款 | 用户 JWT + 应用 AppId | 10 分钟接入 |
| 开放 API（B 端服务端） | 商户后端服务端调用：创建订单、查询、退款、收单统计 | HMAC-SHA256 签名 | 30 分钟接入 |

> 本指南聚焦「商户收银台 + 开放 API」组合，即最常见的「服务端下单 → 浏览器跳收银台 → Webhook 回调」场景。

---

## 3. 商户 5 分钟接入

### Step 1: 注册账号

通过手机号或邮箱注册新用户，成功后返回 JWT `token`，后续用户态接口都需要携带它。

```http
POST /auth/register HTTP/1.1
Host: your-domain:3001
Content-Type: application/json

{
  "nickname": "kebai_merchant",
  "phone": "13800000000",
  "password": "Kebai@2026"
}
```

### Step 2: 实名认证

```http
POST /users/verify-identity
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "realName": "张三",
  "idCard": "440101199001011234",
  "payPassword": "123456"
}
```

提交后进入 PENDING；沙箱环境开启 `SANDBOX_AUTO_APPROVE` 自动通过。

### Step 3: 商户入驻

```http
POST /merchants/register
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "shopName": "示例小店",
  "contactPhone": "13800000000",
  "settleAccount": "your-settle-account"
}
```

提交后由管理员在管理后台「商户管理」通过/驳回。

### Step 4: 创建应用并获取 AppId / AppSecret

商户门户 → 应用管理 → 创建应用：

```http
POST /merchants/apps
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "appName": "生产环境",
  "notifyUrl": "https://your-domain.com/webhook/kebai"
}
```

**响应中的 `appSecret` 仅显示一次，请立即保存**。后续开放 API 调用使用 `appId` + `appSecret` 做 HMAC-SHA256 签名。

### Step 5: 服务端创建收单订单

```http
POST /open-api/v1/orders
X-App-Id: <appId>
X-Timestamp: 1710000000
X-Nonce: random-string
X-Signature: <HMAC-SHA256(SHA256_RAW(appSecret), method\npath\nrawBody\ntimestamp\nnonce\nappId)>
Content-Type: application/json

{
  "outOrderNo": "M202609300001",
  "amount": 0.01,
  "subject": "测试商品",
  "notifyUrl": "https://your-domain.com/webhook/kebai"
}
```

响应返回 `orderNo` 与 `cashierUrl`。

### Step 6: 浏览器跳收银台

将用户浏览器重定向到 `cashierUrl`，用户在收银台选择渠道完成支付。

### Step 7: 接收 Webhook 回调

渠道支付完成后，KeBaiPay 向你配置的 `notifyUrl` 推送收单结果：

```http
POST <notifyUrl>
Content-Type: application/json
X-KB-Signature: <sha256 签名，hex>

{
  "orderNo": "KB20260930xxxx",
  "merchantOrderNo": "M202609300001",
  "amount": 1,
  "amountYuan": 0.01,
  "status": "PAID",
  "paidAt": "2026-09-30T12:00:00Z"
}
```

**必须验签**：以 `SHA256_RAW(appSecret)` 的 32 字节原始摘要为 HMAC 密钥，对 raw body 做 HMAC-SHA256，比对 `X-KB-Signature` 头；金额必须与你下单时一致，否则拒绝。幂等处理同一 `merchantOrderNo`。

### Step 8: 查询订单 / 申请退款 / 收单统计

```http
# 查询订单
GET /open-api/v1/orders/{orderNo}
X-App-Id: <appId> ...

# 申请退款（原路退回）
POST /open-api/v1/refunds
X-App-Id: <appId> ...
{
  "orderNo": "KB20260930xxxx",
  "refundAmount": 0.01,
  "reason": "用户取消"
}

# 收单统计
GET /open-api/v1/stats
X-App-Id: <appId> ...
```

---

## 4. 沙箱测试

默认启用 mock 渠道，可一键完成支付，无需真实渠道凭据：

```bash
npm run start:dev
# 收银台选择 mock 渠道，点击"模拟支付成功"
```

---

## 5. 上线前检查

- [ ] 已在 `.env` 配置真实渠道凭据（AES-256-GCM 加密落库）
- [ ] 已配置 `CHANNEL_NOTIFY_URL`（收单结果回调公网地址）
- [ ] Webhook 端点已验签 + 幂等
- [ ] 金额以「元」为单位传输、「分」为单位存储
- [ ] 已读 [合规模式说明](COMPLIANCE_MODE.md) 与 [上线清单](PRODUCTION_READINESS.md)

---

## 6. 下一步

- [商户手册](MERCHANT_GUIDE.md)：完整字段、错误码、限额、对账
- [API 参考](API_REFERENCE.md)：136 个操作 / 121 条路径
- [SDK 指南](SDK_GUIDE.md)：零依赖 Node SDK
