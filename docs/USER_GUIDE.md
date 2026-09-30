# KeBaiPay 用户使用指南

> 适用版本：v0.3.5（合规聚合模式）
> KeBaiPay 是**合规聚合支付技术服务**。本平台不设余额、不设充值、不设提现、不设转账、不设红包；你作为付款方，通过收银台在持牌渠道完成支付，账单仅记录收单订单与退款。

---

## 1. 我能用 KeBaiPay 做什么

| 能做 | 不能做（已下线） |
|---|---|
| 在商户收银台用微信/支付宝付款 | 在平台充值余额 |
| 查看自己的支付账单与退款记录 | 在平台给他人转账 |
| 实名认证、绑定手机号/邮箱 | 在平台提现到银行卡 |
| 领取并使用商户优惠券 | 收发红包 |
| 使用 AI 助手查询自己的订单/账单 | 在平台存钱、查"平台余额" |

> 资金全程由持牌支付机构清算，平台不经手你的钱。

---

## 2. 注册与登录

```http
POST /auth/register
{ "nickname": "小明", "phone": "13800000000", "password": "..." }

POST /auth/login
{ "phone": "13800000000", "password": "..." }
```

登录后获得 JWT token，后续用户态接口都要带 `Authorization: Bearer <token>`。

---

## 3. 实名认证

```http
POST /users/verify-identity
{
  "realName": "张三",
  "idCard": "440101199001011234",
  "payPassword": "123456"
}
```

- 身份证号 AES-256 加密存储
- 一个证件号只能认证一个账号
- 沙箱环境 `SANDBOX_AUTO_APPROVE=true` 自动通过；生产环境由管理员审核

---

## 4. 付款（收银台）

1. 商户在其服务端调用开放 API 创建收单订单
2. 商户把 `cashierUrl` 发给你的浏览器
3. 你在收银台选择渠道（微信/支付宝）→ 跳渠道完成支付
4. 渠道回调后，订单状态变为 `PAID`
5. 若渠道回调丢失，平台定时任务主动查渠道补单

你不需要在 KeBaiPay 存钱，付款直接从你在微信/支付宝的账户扣。

---

## 5. 我的账单

```http
GET /bills
GET /users/me
```

账单只记录：
- 你发起的收单订单（已支付/已退款/已关闭）
- 退款记录

**没有"平台余额"这一项**。

---

## 6. 优惠券

```http
POST /coupons/:couponNo/claim    # 领取
GET  /coupons/mine/list           # 我领取的列表
GET  /coupons/mine/:userCouponNo  # 详情
```

在收银台结算时可选择已领取的优惠券抵扣。

---

## 7. 退款

- 由商户在其服务端发起退款（`POST /open-api/v1/refunds`）
- 退款原路返回你在微信/支付宝的账户
- 平台不经手退款资金

---

## 8. AI 助手

```http
POST /agent/login                # 换取 Agent 访问令牌
POST /agent/authorize            # 授权某智能体
POST /agent/chat                 # 对话
POST /agent/confirm              # 确认/拒绝待确认操作
POST /agent/revoke/:authId        # 撤销授权
```

AI 助手可以帮你查订单、查账单。所有操作受 scope 授权、单笔/日限额、二次确认约束，每次调用进审计链。

---

## 9. 账号安全

| 能力 | 路径 |
|---|---|
| 修改登录密码 | `POST /users/change-password` |
| 重置支付密码 | `POST /users/reset-pay-password` |
| 绑定/换绑手机号 | `POST /users/bind-phone` |
| 绑定/换绑邮箱 | `POST /users/bind-email` |
| 登录日志 | `GET /users/login-logs` |
| 当日限额 | `GET /users/daily-limit` |

---

## 10. 常见问题

| 问题 | 回答 |
|---|---|
| 我的钱存在 KeBaiPay 吗 | 不存在。你不充值、不提现，钱始终在微信/支付宝里 |
| 付款后商户说没收到 | 渠道回调可能延迟；平台 15 分钟内自动补单，也可在账单页查看订单状态 |
| 退款去哪了 | 原路退回你付款的渠道账户 |
| 能给朋友转账吗 | 不能。平台不提供 P2P 转账 |
| 能发红包吗 | 不能。红包能力已下线 |
