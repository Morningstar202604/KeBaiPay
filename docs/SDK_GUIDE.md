# KeBaiPay 开放 API SDK 使用说明

> 版本：v0.3.5（合规聚合模式）
> 适用：商户后端服务端调用 `/open-api/v1/*`
> 本 SDK 仅提供**收单、查单、退款、收单统计**四类能力。平台不提供转账、查余额、红包、担保、分账、订阅等端点。

---

## 1. 安装

Node.js（零依赖，仅用内置 `crypto` / `https`）：

```js
// kebai.js — 可直接拷贝到你的项目
const crypto = require('crypto')
const https = require('https')

class KebaiClient {
  constructor({ appId, appSecret, baseUrl }) {
    this.appId = appId
    this.appSecret = appSecret
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  _sign(method, path, body, timestamp, nonce) {
    const payload = timestamp + nonce + (body || '')
    return crypto.createHmac('sha256', this.appSecret).update(payload).digest('hex')
  }

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      const nonce = crypto.randomBytes(8).toString('hex')
      const bodyStr = body ? JSON.stringify(body) : ''
      const signature = this._sign(method, path, bodyStr, timestamp, nonce)

      const url = new URL(this.baseUrl + path)
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'X-App-Id': this.appId,
          'X-Timestamp': timestamp,
          'X-Nonce': nonce,
          'X-Signature': signature,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(data ? JSON.parse(data) : {}) } catch { resolve(data) }
        })
      })
      req.on('error', reject)
      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }

  createOrder(params)  { return this._request('POST', '/open-api/v1/orders', params) }
  getOrder(orderNo)    { return this._request('GET',  '/open-api/v1/orders/' + orderNo) }
  refund(params)       { return this._request('POST', '/open-api/v1/refunds', params) }
  stats()              { return this._request('GET',  '/open-api/v1/stats') }
}

module.exports = { KebaiClient }
```

---

## 2. 初始化

```js
const { KebaiClient } = require('./kebai')

const client = new KebaiClient({
  appId: 'your-app-id',
  appSecret: 'your-app-secret', // 仅创建时显示一次
  baseUrl: 'https://api.your-kebai-deployment.com',
})
```

---

## 3. API

### 3.1 创建收单订单

```js
const order = await client.createOrder({
  outOrderNo: 'M202609300001',
  amount: 0.01,           // 元
  subject: '测试商品',
  notifyUrl: 'https://your-domain.com/webhook/kebai',
})
// { orderNo, cashierUrl, ... }
// 把 cashierUrl 302 到用户浏览器
```

### 3.2 查询订单

```js
const detail = await client.getOrder('KB20260930xxxx')
```

### 3.3 申请退款（原路退回）

```js
const refund = await client.refund({
  orderNo: 'KB20260930xxxx',
  refundAmount: 0.01,
  reason: '用户取消',
})
```

### 3.4 收单统计

```js
const stats = await client.stats()
// { successCount, successAmount, feeAmount, refundAmount, ... }
```

---

## 4. Webhook 接收（Node.js 示例）

```js
const crypto = require('crypto')
// 在你的 HTTP server 里：
app.post('/webhook/kebai', (req, res) => {
  const signature = req.headers['x-kb-signature']
  const body = JSON.stringify(req.body)
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest('hex')
  if (signature !== expected) return res.status(401).end()

  // 幂等处理：以 outOrderNo / refundNo 去重
  // 金额必须与你下单时一致
  res.status(200).end()
})
```

---

## 5. 错误处理

| HTTP | code | 处理建议 |
|---|---|---|
| 401 | KB401 | 签名错/时间戳超窗；检查服务器时钟与 appSecret |
| 403 | KB717 | 应用被禁用，联系管理员 |
| 404 | KB603 | 订单不存在，检查 orderNo |
| 400 | KB713 | 订单不可退（非 PAID 状态） |
| 400 | KB715 | 退款金额大于可退金额 |

---

## 6. 已删除的方法（请勿调用）

以下方法在旧版 SDK 中存在，v0.3.x 起**全部下线**，对应端点已从代码与 openapi 中移除：

- `transfer(...)` —— P2P 转账，端点 `/open-api/v1/transfers`
- `getBalance(...)` —— 查平台余额，端点 `/open-api/v1/balance`
- Webhook 事件 `TRANSFER_*` —— 已下线

如你的代码仍在调用这些方法，请迁移到收单/退款/对账模型。
