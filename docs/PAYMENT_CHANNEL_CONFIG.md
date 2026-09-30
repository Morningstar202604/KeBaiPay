# 支付渠道配置指南

> 本文档介绍如何在 KeBaiPay 管理后台配置微信支付和支付宝渠道，包含申请流程、配置字段说明和 API 调用示例。

## 目录

- [概述](#概述)
- [微信支付渠道配置](#微信支付渠道配置)
- [支付宝渠道配置](#支付宝渠道配置)
- [测试与验证](#测试与验证)
- [常见问题](#常见问题)

---

## 概述

KeBaiPay 支持多种支付渠道，渠道配置通过管理后台 API 完成：

| API 路径 | 方法 | 说明 | 权限 |
|---------|------|------|------|
| `/admin/channels` | GET | 查询渠道列表（脱敏） | `admin:view` |
| `/admin/channels` | POST | 创建渠道 | `risk:config` |
| `/admin/channels/:code` | PUT | 更新渠道 | `risk:config` |
| `/admin/channels/:code` | DELETE | 删除渠道 | `risk:config` |
| `/admin/channels/:code/test` | POST | 测试渠道连通性 | `risk:config` |

渠道凭据采用 **AES-256-GCM 加密**存储（密文以 `enc:v1:` 为前缀），保存后热同步到连接器运行时，无需重启服务。

---

## 微信支付渠道配置

### 申请资质

在配置前，需从微信支付商户平台获取以下信息：

1. 登录 [微信支付商户平台](https://pay.weixin.qq.com/)
2. 进入「账户中心」→「API安全」→「API证书」
3. 使用微信证书工具生成商户证书私钥和公钥

### 所需配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `appid` | string | ✅ | 商户绑定的应用ID（公众号/小程序/APP的appid） |
| `mchid` | string | ✅ | 商户号（10位数字） |
| `serialNo` | string | ✅ | 商户API证书序列号（证书工具导出时可见） |
| `privateKey` | string | ✅ | 商户API私钥（PEM格式，含 `-----BEGIN PRIVATE KEY-----`） |
| `apiV3Key` | string | ✅ | APIv3密钥（32位字符，商户平台设置） |
| `notifyUrl` | string | ✅ | 回调通知地址（必须可公网访问） |
| `platformCert` | string | string | 平台证书公钥（用于验签回调，可通过 [微信支付APIv3文档](https://wechatpay-api.gitbook.io/wechatpay-api-v3) 下载） |

### 配置步骤

#### 1. 登录管理后台获取 Token

```bash
curl -X POST http://localhost:3001/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_admin_password"}'
```

响应：
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### 2. 创建微信支付渠道

```bash
curl -X POST http://localhost:3001/admin/channels \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "wechat",
    "name": "微信支付",
    "enabled": true,
    "priority": 100,
    "config": "{\"appid\":\"wx1234567890\",\"mchid\":\"1234567890\",\"serialNo\":\"5A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P\",\"privateKey\":\"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg...\\n-----END PRIVATE KEY-----\",\"apiV3Key\":\"your_api_v3_key_32chars\",\"notifyUrl\":\"https://your-domain.com/webhooks/recharge/wechat\",\"platformCert\":\"-----BEGIN CERTIFICATE-----\\nMIIDXTCCAkWgAwIBAgIJAJC...\\n-----END CERTIFICATE-----\"}"
  }'
```

#### 3. 验证配置

检查返回结果，确认渠道创建成功。敏感字段会自动脱敏显示（如 `MIIEvQ...****`）。

---

## 支付宝渠道配置

### 申请资质

在配置前，需从支付宝开放平台获取以下信息：

1. 登录 [支付宝开放平台](https://open.alipay.com/)
2. 创建应用并获取 APPID
3. 设置应用公钥和支付宝公钥（使用 RSA2 签名）
4. 在应用配置中设置异步通知地址（notify_url）和同步跳转地址（return_url）

### 所需配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `appId` | string | ✅ | 支付宝应用ID（2088开头或字母数字组合） |
| `privateKey` | string | ✅ | 应用私钥（PKCS8格式，PEM字符串） |
| `alipayPublicKey` | string | ✅ | 支付宝公钥（从支付宝开放平台获取） |
| `notifyUrl` | string | ✅ | 异步通知地址 |
| `returnUrl` | string | ✅ | 同步跳转地址 |
| `signType` | string | ✅ | 签名类型，固定为 `RSA2` |
| `sandbox` | boolean/string | – | 是否沙箱环境，默认 false |

### 配置步骤

#### 1. 创建支付宝渠道

```bash
curl -X POST http://localhost:3001/admin/channels \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "alipay",
    "name": "支付宝",
    "enabled": true,
    "priority": 90,
    "config": "{\"appId\":\"2021001234567890\",\"privateKey\":\"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg...\\n-----END PRIVATE KEY-----\",\"alipayPublicKey\":\"-----BEGIN PUBLIC KEY-----\\nMIIBIjANBg...\\n-----END PUBLIC KEY-----\",\"notifyUrl\":\"https://your-domain.com/webhooks/recharge/alipay\",\"returnUrl\":\"https://your-domain.com/success\",\"signType\":\"RSA2\",\"sandbox\":false}"
  }'
```

#### 2. 沙箱环境测试

如需使用沙箱环境，将 `sandbox` 设为 `true`，系统会自动切换到沙箱网关：
- 生产网关：`https://openapi.alipay.com/gateway.do`
- 沙箱网关：`https://openapi-sandbox.dl.alipaydev.com/gateway.do`

---

## 测试与验证

### 测试渠道连通性

```bash
curl -X POST http://localhost:3001/admin/channels/wechat/test \
  -H "Authorization: Bearer YOUR_TOKEN"
```

响应：
```json
{
  "code": "wechat",
  "name": "微信支付",
  "available": true,
  "message": "微信支付 渠道可用"
}
```

### 查询渠道列表

```bash
curl -X GET http://localhost:3001/admin/channels \
  -H "Authorization: Bearer YOUR_TOKEN"
```

响应（敏感字段已脱敏）：
```json
[
  {
    "id": "ch_001",
    "code": "wechat",
    "name": "微信支付",
    "enabled": true,
    "priority": 100,
    "config": "{\"appid\":\"wx1234567890\",\"mchid\":\"1234567890\",\"serialNo\":\"5A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P\",\"privateKey\":\"MIIEvQ******\",\"apiV3Key\":\"your_api******\",\"notifyUrl\":\"https://your-domain.com/webhooks/recharge/wechat\",\"platformCert\":\"-----BEGIN C******\"}"
  }
]
```

---

## 常见问题

### Q1: 如何获取微信支付 APIv3 密钥？

登录微信支付商户平台 → 「账户中心」→「API安全」→「APIv3密钥」，点击「重置密钥」后复制 32 位密钥。

### Q2: 平台证书如何获取？

从 [微信支付APIv3文档中心](https://wechatpay-api.gitbook.io/wechatpay-api-v3) 下载平台证书，或在代码中调用微信支付 API 获取证书列表。

### Q3: 支付宝公钥和应用私钥如何生成？

使用支付宝开放平台提供的 [密钥生成工具](https://opendocs.alipay.com/common/02kipl) 生成 RSA2 密钥对，将应用私钥填入系统，应用公钥上传到支付宝开放平台。

### Q4: notifyUrl 为什么必须公网可访问？

支付成功后，微信/支付宝会向该地址发送异步通知，确认支付结果。如果无法访问，会导致订单状态不一致。

### Q5: 渠道配置修改后需要重启服务吗？

不需要。系统会自动热同步配置到连接器运行时，立即生效。

### Q6: 如何切换渠道优先级？

通过 PUT `/admin/channels/:code` 更新 `priority` 字段，数值越大优先级越高。系统在有多渠道时优先使用高优先级渠道。

---

## 对账接入

合规聚合模式下，对账分两步（见 `docs/COMPLIANCE_MODE.md` 第 4 节）：

1. **系统内核对**（自动）：`reconciliation` 服务将当日收单订单统计（成功金额/
   手续费/退款/笔数）与 `finance` 日报快照交叉核对，差异写入对账报告；
2. **通道账单核对**：已实现"模拟演练"与真实账单共用的核对链路（服务：
   `reconciliation`，记录表：`channel_bill_checks`，按 日期+通道 唯一）。

### 模拟演练（当前无真实商户号时使用）

Admin 端「财务总览」页内置"通道账单对账（模拟演练）"卡片，或直调 API：

```bash
# ① 生成模拟账单（基于当日收单订单生成 CSV，字段对齐官方账单结构）
curl -X POST "http://localhost:3001/admin/reconciliation/channel-bill/generate?date=2026-09-30&channel=mock" \
  -H "Authorization: Bearer YOUR_TOKEN"

# ② 执行核对（缺省完全匹配；可注入差异演示检出能力）
curl -X POST http://localhost:3001/admin/reconciliation/channel-bill/reconcile \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"date":"2026-09-30","channel":"mock","missingPlatformOrders":1,"extraChannelOrders":1,"amountMismatchOrders":1}'

# ③ 查询核对记录
curl -X GET http://localhost:3001/admin/reconciliation/channel-bill/checks?startDate=2026-09-30 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

核对结果（MATCHED/MISMATCH + 差异明细）写入 `channel_bill_checks`，
运行 `runReconciliation` 时自动引用当日核对状态替换 `channel_bill_pending` 占位。

### 真实通道接入（拿到商户号后）

**官方账单解析器已内置**（`src/finance/bill-parser.ts`，无需额外开发）：

- `parseWechatBill`：兼容微信支付 V2/V3 交易账单（按表头关键词定位列：商户订单号/
  微信订单号/应结金额或总金额/手续费/交易状态/退款单号；自动处理行尾逗号、汇总行、引号字段）
- `parseAlipayBill`：兼容支付宝交易账单（商户订单号/支付宝交易号/订单金额（元）/
  服务费（元）/业务类型/退款批次号，退款批次号非空即退款单）
- 金额自动 元→分，时间自动解析，列数异常/字段缺失会输出 warnings

接入步骤：

1. 在微信支付/支付宝商户平台开通"账单下载"权限，按日下载官方交易账单（CSV）；
2. Admin「财务总览 → 导入官方账单核对」粘贴账单内容（或直调
   `POST /admin/reconciliation/channel-bill/reconcile` 传 `billSource: 'official'` + `billText`），
   系统解析后与平台订单逐笔核对，差异明细入 `channel_bill_checks`；
3. 可加定时任务（如每日 02:00）自动下载 + 自动核对，差异告警到管理端。

> 通道账单与订单逐笔一致，是聚合模式下证明"资金未在平台沉淀"的关键证据。
> 模拟演练与真实账单共用同一核对链路，仅账单来源不同（mock / official）。
