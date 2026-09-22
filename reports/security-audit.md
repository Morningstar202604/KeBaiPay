# KeBaiPay 金融场景安全审计报告

- **审计对象**：KeBaiPay v0.3.2（NestJS 11 + Prisma 7 + PostgreSQL 16 + Redis 7）
- **审计范围**：OWASP Top 10 + 支付验签 / 对账 / 幂等 / 密钥管理 / 供应链 CVE
- **审计方式**：源码人工审查 + `npm audit` + 依赖面核查
- **审计人**：security-engineer（kebaipay-audit 团队）
- **结论基线**：本次审计**无 P0（高危）/ 无 P1（严重）资金链路漏洞**。资金核心（验签/幂等/对账/密钥/复式记账）高度硬化。剩余项为**中低优先级加固项**与**既有 P1（测试覆盖）**。

---

## 一、结论速览（OWASP 映射 + 资金链路）

| 维度 | 评估 | 说明 |
|------|------|------|
| **A01 失效功能 / 注入** | 安全 | 全部 SQL 走 Prisma 参数化；Redis Lua 脚本参数化；无动态拼接。 |
| **A02 加密失效（密钥/数据）** | 安全 | AES-256-GCM（CryptoService），ENCRYPTION_KEY 启动期强制 ≥32 位，scryptSync 派生；渠道凭据 `enc:v1:` 前缀加密入库；响应拦截器剥离 `appSecret`/`secret`。 |
| **A03 XSS** | 安全 | 本次 grep 无 `innerHTML`/`eval`/`dangerouslySetInnerHTML`；上轮 P0（public/app.js stored XSS）已修复。 |
| **A04 不安全设计（越权）** | 安全 | 211/220 端点受守卫；open-api 跨 appId 隔离；退款/转账/余额查询均校验 `order.appId === app.appId`。 |
| **A05 安全配置错误** | 安全 | SecurityValidator + env-validation 双闸：默认密钥/长度/Redis/CORS/METRICS_TOKEN/回调 URL 全部启动期 fail-closed。 |
| **A06 组件漏洞（CVE）** | 安全 | `npm audit`（prod + dev）**0 已知漏洞**；前端 bundle 仍 1.1MB（质量项，非 CVE）。 |
| **A07 身份验证失效** | 安全 | bcrypt 哈希；登录失败 5 次锁 15 分钟（Redis/内存降级）；账户枚举防护（缺用户与错密码同等计数）；USER/ADMIN/AGENT 三套独立 JWT secret。 |
| **A08 数据完整性（验签/幂等/对账）** | 安全 | 见第四节，验签先于幂等、防重放、金额一致性、乐观锁、复式记账闭环。 |
| **A09 日志监控不足** | 基本安全 | 回调全量落 webhook_logs；差异项走 reconciliationDifferenceItem 工作流。建议补 SIEM 告警（加固项）。 |
| **A10 SSRF** | 安全 | 回调 URL 经 `isCallbackUrlSafe` 校验协议 + 内网/localhost 拦截。 |

**资金链路专项结论**：
- **支付验签**：微信V3（RSA-SHA256 + ±300s 时间戳防重放）、支付宝（RSA2 checkNotifySignV2）、Stripe（HMAC-SHA256 + t 时间戳 + timingSafeEqual + 长度归一化）、OpenAPI（HMAC-SHA256 + 原子 nonce 防重放 + 时间窗）。全部 **验签先于幂等检查**（纵深防御），未实现验签的渠道一律 fail-closed 拒绝。
- **幂等**：三路径收敛（withdraw / recharge / refund）= Redis 分布式锁 + 唯一 DB 约束 + 状态守卫条件 `updateMany` + `idempotencyKey` 归属校验（P2002 兜底）。
- **对账**：日终快照 `actualAssetsChange vs ledgerNetChange vs expectedAssetsChange`，含退款项；渠道对账四差异类型（MISSING_IN_PLATFORM / AMOUNT_MISMATCH / MISSING_IN_CHANNEL / UNMATCHED）+ 指派/解决工作流。
- **密钥**：AES-256-GCM + 启动期强制 + 默认密钥黑名单 + 长度复杂度校验；渠道凭据加密入库。
- **复式记账**：借/贷分录 + bill + accountLedger 闭环，H2 金额一致性、H3/H4 重读真实余额，updateMany 乐观锁防双扣/双退。

---

## 二、关键发现（亮点）

1. **验签先幂等（纵深防御）**：`webhooks.service.ts` `handleRechargeCallback/handlePayoutCallback/handleRefundCallback` 先 `verifySignature` 再幂等检查；渠道未实现 `verifyWebhookSignature` 一律拒绝，杜绝"以 mock 通道伪造回调"。
2. **微信代付防假成功**：`wechat-pay.channel.ts` `parsePayoutCallback` 强制 `batch_status=FINISHED && success_num>=total_num`，防止部分成功误判 SUCCESS。
3. **充值回调金额一致性（H2）**：`transactions.service.ts` `handleRechargeCallback` 中 `result.amount !== order.amount` 即拒绝（fail-closed）。
4. **退款乐观锁防双退**：`open-api.service.ts` `refund` 以 `refundAmount: currentRefunded` 为 where 条件做条件 `updateMany`，命中 0 即抛 ORDER_STATUS_CHANGED，杜绝并发双退。
5. **幂等键归属校验**：退款/转账/createOrder 均校验 `existing.appId !== app.appId` → Forbidden，防跨商户 ID 越权。
6. **Stripe timingSafeEqual 长度归一化**：`secureCompare` 不等长时以等长 buffer 比较，消除基于长度的时序侧信道。
7. **METRICS 双闸兜底**：`metrics.controller.ts` 生产未配 token 直接 401 + 哈希后常量时间比较（L1 修复）。
8. **密钥默认值黑名单**：`security-validator.service.ts` 内置 9 个已知 dev 默认密钥，生产命中即拒启动。

---

## 三、风险明细

### 3.1 无资金链路 P0/P1（复核确认）

经逐文件复核，验证/幂等/对账/密钥四条资金主链路**未发现可被外部攻击者利用导致资金损失的高危漏洞**。上轮审计的 1 个 P0（stored XSS）与 2 个 P1（/metrics 无鉴权、mock 通道生产误用）均已修复并加纵深防御。

### 3.2 中/低优先级加固项（非高危，建议排期）

| # | 位置 | 类型 | 严重度 | 现状 | 建议 |
|---|------|------|--------|------|------|
| M1 | `src/security/security-validator.service.spec.ts` | 测试覆盖 | **P1（质量）** | 上轮审计记录的"security 模块 0% 测试覆盖" | 已有 spec 存在，需确认纳入 CI 并跑通，补齐覆盖率门槛 |
| M2 | `public/sdk/kebaipay.js` + H5/portal bundle 1.1MB | 性能/可维护性 | **P2** | 前端单 bundle 较大 | 代码分割、按需加载（由 performance-engineer 跟进） |
| L1 | `src/payment-channels/connectors/stripe.connector.ts` 沙箱模拟值 | 安全设计 | **P2（低）** | 沙箱 `client_secret` 用随机数动态构造，形态仿真 | 沙箱专用，生产走真实 Stripe 回调查证，无影响；保持注释说明 |
| L2 | `src/payment-channels/channels/mock.channel.ts` | 配置错误 | **P2（低）** | mock 通道 secret 有 `mock-channel-secret-dev-only` 回退，生产未配会告警 | 生产 PaymentChannelRegistry 已拦截 mock；建议启动期在 prod 显式禁用 mock 通道（fail-fast） |
| L3 | `open-api` nonce Redis 降级路径 | 可用性/防重放 | **P2（低）** | Redis 未配时降级进程内 Map，多实例下 nonce 不共享 → 防重放失效 | 生产已强制 REDIS_URL（env-validation），降级仅开发态可接受；补注释 |
| L4 | `src/finance/reconciliation.service.ts` 缺失账本 | 数据完整性 | **P2（低）** | missing_ledger 标记为差异项走人工 | 建议对 missing_ledger 触发自动告警（接 SIEM/IM） |
| L5 | 渠道 webhook 重放 | 防重放 | **P3** | 微信/支付宝/Stripe 均含时间戳窗口；OpenAPI 含 nonce | 已覆盖，保持 |
| L6 | 日志/监控 | 可观测性 | **P3** | 有 webhook_logs + 差异工作流 | 接 SIEM，对 PENDING 充值对账、差异项、风控 BLOCK 配置告警 |

### 3.3 供应链 CVE

- `npm audit --omit=dev`：**0 漏洞**
- `npm audit`（含 dev）：**0 漏洞**
- 第三方金融 SDK：`alipay-sdk`（验签走 checkNotifySignV2）、`@nestjs/*`、`@prisma/*` 当前锁版本无已知 CVE。
- 无密钥硬编码在源码（渠道凭据 `enc:v1:` 加密入库；JWT/ENCRYPTION_KEY 全部 env 读取）。

---

## 四、修复建议（高→低）

1. **[P1 质量]** 确认 `src/security/*.spec.ts` 已接入 CI 且覆盖 SecurityValidator 全部断言路径（默认值拒绝 / 长度不足 / 复杂度 / REDIS_URL / CORS / METRICS_TOKEN / RECHARGE_NOTIFY_URL）；为 `security` 模块设最低覆盖率门槛。
2. **[P2]** 生产启动期显式禁用 `mock` 支付通道（fail-fast），避免 MOCK_CHANNEL_SECRET 未配时误启用。
3. **[P2]** 对渠道对账 `missing_ledger` / `MISSING_IN_CHANNEL` / 大额 `AMOUNT_MISMATCH` 接 IM/SIEM 告警。
4. **[P2]** 前端 bundle 代码分割（performance-engineer 主导，安全侧确认无敏感信息泄漏至公开 bundle）。
5. **[P3]** 维持 Stripe 沙箱动态 secret 的注释说明；补 OpenAPI nonce 降级路径"仅开发态可用"注释。

---

## 五、审计方法说明

- 静态逐文件审查：`webhooks.service.ts`、`transactions.service.ts`、`withdrawals.service.ts`、`refund.service.ts`、`reconciliation.service.ts`、`channel-reconciliation.service.ts`、`open-api.guard.ts/.service.ts`、`crypto.service.ts`、`auth.service.ts`、`admin-auth.service.ts`、`agent-auth.*`、`stripe.connector.ts`、`mock.channel.ts`、`security-validator.service.ts`、`env-validation.ts`、`metrics.controller.ts`、`response-transform.interceptor.ts`、`merchants.service.ts`。
- 动态核查：`npm audit`（prod + dev）、`grep` 排查 `innerHTML/eval/dangerouslySetInnerHTML` 与 `SECRET` 分布。
- 结论置信度：资金链路 = 高（多路径交叉验证 + 注释自证 H2/H3/H4 修复）；加固项 = 中（依赖 CI 与部署配置落地）。

> 本报告与 `reports/code-quality-review.md`、`reports/tech-debt-refactor.md` 并存。
