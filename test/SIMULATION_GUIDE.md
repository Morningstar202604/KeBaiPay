# KeBaiPay 端到端场景模拟测试指南

## 概述

本文档描述 KeBaiPay 系统中 6 个核心用户场景的集成测试，覆盖完整的支付因果链条。

测试文件：
- `test/user-scenarios.e2e-spec.ts` — 主要的 e2e 场景测试
- `test/ARTIFACT.md` — 测试设计与实现说明

## 运行方式

### 前置条件
```bash
cd /path/to/KeBaiPay
npm install
```

### 运行 e2e 测试
```bash
npx jest test/user-scenarios.e2e-spec.ts --no-coverage
```
或运行 test/ 目录下所有测试：
```bash
npx jest test/ --no-coverage
```

### TypeScript 编译检查
```bash
npx tsc --noEmit
```

## 6 个场景含义

### 场景 1: 完整的充值支付闭环 ✅
**覆盖链：** 用户注册 → 实名认证 → 设支付密码 → 配置渠道 → 充值 → 回调 → 到账

**断言：**
- 订单状态变为 `SUCCESS`
- 账户余额增加（可用余额 = 充值金额）
- 会计分录借贷平衡
- 账本（AccountLedger）记录正确
- 账单（Bill）记录正确
- 无风控拦截事件产生

### 场景 2: 退款流程 ✅
**前提：** 场景 1 已完成充值
**覆盖链：** 充值成功 → 发起退款 → 退款成功 → 余额回退

**断言：**
- 退款单状态 `SUCCESS`
- 账户余额减少（可用余额减少退款金额）
- 退款账本记录正确
- 退款金额不超过原充值金额

### 场景 3: 失败降级 & 重试 ✅
**覆盖链：** 主连接器模拟失败 → ConnectorRouter 检测失败 → 尝试降级 → 降级日志 → 恢复后成功

**模拟手段：**
- `MockConnector.setSimulateFailure(true)` 模拟连接器故障
- `ConnectorRouter` 遍历连接器候选人
- 恢复后 `setSimulateFailure(false)` 验证连接器重新可用

### 场景 4: 风控拦截 ✅
**覆盖链：** 频繁充值 → 风控规则触发 → 请求被拦截 → RiskEvent 记录

**模拟手段：**
- 在 `systemConfig` 中配置 `risk_rule:single_amount` 为低阈值（50分）
- 充值 1 元（100分）触发风控
- 验证 `ForbiddenException` 被抛出
- 验证 `RiskEvent` 被创建

### 场景 5: 多并发订单 ✅
**覆盖链：** 同时发起 10 个充值 → 全部创建 → 批量回调 → 全部到账

**断言：**
- 10 个订单全部创建（`transactionOrder` 表）
- 10 个回调全部成功
- 10 个订单状态全部 `SUCCESS`
- 可用余额 = 单个金额 × 10

### 场景 6: 对账差异自动修正 ✅
**覆盖链：** 创建小额差异（30分 AMOUNT_MISMATCH）→ 运行 auto-fix → 标记 IGNORED → RiskEvent 记录

**断言：**
- 差异状态变为 `IGNORED`
- `RiskEvent` 被创建（`level = LOW`, `handled = true`）
- 超阈值（> 50分）的差异不被自动修正

## 技术架构

### Mock 策略

```
┌─────────────────────────────────────┐
│          Nest Test Module           │
│  Test.createTestingModule()         │
├─────────────────────────────────────┤
│  ┌──────────┐  ┌──────────────────┐ │
│  │ Real     │  │   Mock Layer     │ │
│  │ Business │  │ ┌──────────────┐ │ │
│  │ Services │  │ │ MockPrisma   │ │ │
│  │          │  │ │ (In-Memory)  │ │ │
│  │ Transactions│ │ │              │ │ │
│  │ Refund   │  │ └──────────────┘ │ │
│  │ RiskEngine│  │ ┌──────────────┐ │ │
│  │ Connector │  │ │ MockRedis    │ │ │
│  │ Router   │  │ │ (In-Memory)  │ │ │
│  │ AutoFix  │  │ └──────────────┘ │ │
│  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────┘
```

- **MockPrismaClient**: 完整实现的 in-memory Prisma 替代
  - 支持 `findUnique`, `findFirst`, `findMany`, `create`, `update`, `updateMany`, `delete`, `count`, `aggregate`, `upsert`, `$transaction`
  - 支持 Prisma 条件运算符（`equals`, `gt`, `gte`, `lt`, `lte`, `in`, `startsWith`, `OR`, `AND`, `NOT`）

- **MockRedisClient**: 支持 Redis 锁、缓存、滑动窗口计数、限流

### 签名机制

Mock 通道使用 HMAC-SHA256 签名，测试中用 `signMockBody()` 生成正确签名：
```
signature = HMAC-SHA256(secret, `${orderNo}${channelOrderNo}${amount}`)
```

## Postman 手动测试集合

### 环境变量
```
{{BASE_URL}} = http://localhost:3000
{{USER_ID}} = <创建用户后获取>
{{ORDER_NO}} = <创建订单后获取>
```

### 接口列表

#### 1. 用户注册
```
POST {{BASE_URL}}/auth/register
{
  "nickname": "测试用户",
  "phone": "13800138000",
  "loginPassword": "password123"
}
```

#### 2. 实名认证提交
```
POST {{BASE_URL}}/users/verify-identity
{
  "realName": "张三",
  "idCard": "110101199001011234",
  "payPassword": "123456"
}
```

#### 3. 发起充值
```
POST {{BASE_URL}}/transactions/recharge
{
  "amount": 100.00,
  "payPassword": "123456",
  "idempotencyKey": "unique-key-001"
}
```

#### 4. 模拟回调（MockChannel）
```
POST {{BASE_URL}}/webhooks/recharge/mock
Content-Type: application/json
x-signature: <HMAC-SHA256签名>

{
  "orderNo": "R...",
  "channelOrderNo": "MOCK_R_R...",
  "amount": 10000,
  "status": "SUCCESS"
}
```

#### 5. 查询订单
```
GET {{BASE_URL}}/transactions/order/{{ORDER_NO}}
```

#### 6. 查询余额
```
GET {{BASE_URL}}/accounts/balance
```

#### 7. 发起退款
```
POST {{BASE_URL}}/payment-channels/refund
{
  "orderNo": "R...",
  "amount": 5000,
  "reason": "商品退货"
}
```

#### 8. 查询账单
```
GET {{BASE_URL}}/bills?page=1&pageSize=20
```

#### 9. 查询风控事件（管理员）
```
GET {{BASE_URL}}/admin/risk-events?userId={{USER_ID}}
```

## 故障排查

### 测试失败可能原因

| 错误 | 可能原因 | 解决方案 |
|------|---------|---------|
| `$transaction is not a function` | `overrideProvider` 未正确注入 | 确保 `mockPrisma` 实例包含所有 Prisma 模型方法 |
| `Cannot find module 'src/...'` | ts-jest 路径别名未配置 | 检查 jest 配置中的 `moduleNameMapper` |
| `handleRechargeCallback` 返回非 200 | 签名不匹配 | 检查 `signMockBody` 中的 secret 是否与 MockChannel 一致 |
| 余额不对 | 回调状态未成功 | 检查 `callbackBody` 中的 `status: 'SUCCESS'` |
| 风控未拦截 | 缓存未清除 | 确保 `riskEngine.clearCache()` 已调用 |

### 调试技巧
1. 在测试中添加 `.only` 只运行单个场景：
   ```typescript
   describe.only('场景 1: 完整充值支付闭环', () => { ... })
   ```
2. 用 `console.log(mockPrisma.getTable('xxx'))` 检查内存数据
3. 设置 `NODE_ENV=test` 确保不走生产环境限制
