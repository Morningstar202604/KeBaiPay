# KeBaiPay 性能剖析与优化建议

- 评审对象：NestJS 12（全 ESM）+ Prisma 7（Postgres/PrismaPg）+ ioredis + 微信/支付宝/Stripe + @modelcontextprotocol/sdk
- 评审性质：只读静态剖析（**未修改任何 src/ 业务代码**，下文均为建议）
- 生成方式：逐文件 Read 取证 + 与 `prisma/schema.prisma` 索引对照
- 日期：2026-09-22

---

## 0. 阅读指引

- 优先级：H = 资金路径/可量化延迟瓶颈，M = 可优化但影响中等，L = 工程性优化/容量。
- 每条断言附 `文件:行`；无法直接量化的标注定性影响或 `[待核实]`。
- 「最高性价比」3 条见文末第 9 节。

---

## 1. DB 层（N+1 / 全量查询 / 大事务 / 缺索引）

### P0-1（H）风控日计数 `getDailyCount` 全量 `count()` 无 LIMIT 且走 OR 扫描
- 位置：`src/risk/risk-engine.service.ts:438-451`（`getDailyCount`）、`453-467`（`getDailyAmount`）
- 现状：每次 `riskEngine.check()` 命中 `daily_count`/`daily_amount` 规则都会跑
  `transactionOrder.count/aggregate`，`where: { OR: [{fromUserId},{toUserId}], type, createdAt: {gte: startDate}, status: 'SUCCESS' }`。
- 影响（量化）：
  - `OR` 走两条索引（`@@index([fromUserId])` L167、`@@index([toUserId])` L168）再 UNION，**`createdAt` 与 `status` 不在任一并列索引中**（schema 仅 L172 `@@index([status, completedAt])`，与 `createdAt` 字段不一致）。
  - 高频用户（每日 50 次上限，L82）每天触发 50 次该扫描；活跃账户越多越慢。属**每笔交易必经**的热路径。
- 建议：
  1. 加复合索引 `@@index([fromUserId, createdAt, status])` 与 `@@index([toUserId, createdAt, status])`，覆盖 `count/aggregate`。
  2. 更佳：把「当日累计金额/次数」缓存进 `DailyLimitUsage`（已有 `@@unique([userId, limitType, date])` L455，且转账事务内已在累加，见 `checkAndIncrementDailyLimit` `users.service.ts:428-438`），`getDailyAmount` 直接读该表，省掉 2 次 OR 全量聚合。
- 优先级：H

### P0-2（H）`reconcilePendingRecharge` / 兜底扫描逐笔串行 + 逐笔外呼渠道
- 位置：`src/transactions/transactions.schedule.ts:65-114`、`src/transactions/transactions.service.ts:376-474`
- 现状：`scanTimeoutOrders` 每 5 分钟取 `take: 200` 笔 PENDING 超时订单（L73），然后 `for` 循环逐笔 `await reconcilePendingRecharge(order)`；每笔内部**先做渠道网络查单**（`channel.queryOrder` L404，锁外）再做 `$transaction` 入账。
- 影响（量化/定性）：
  - 200 笔串行外呼，单笔查单典型 200ms~1s（含网络+渠道侧），最坏 200 × 1s ≈ 200s，**远超 5 分钟 cron 周期** → 队列积压、下一轮又叠加 200 笔，PENDING 收敛能力线性退化。
  - 单笔查单失败（网络抖动）即 `STILL_PENDING`，等下一轮，进一步放大延迟。
  - 每笔还触发一次 `getEnabledConfig` DB 查渠道配置（L399）→ 200 次重复查同一张配置表。
- 建议：
  1. 渠道配置 `getEnabledConfig(channelName)` 在循环外查一次，复用（去 200 次重复查询）。
  2. 查单并发化：用带并发上限（如 `p-limit(20)`）的池化并发查单，替代完全串行；入账仍逐笔持锁（锁互斥不变）。
  3. 对 `STILL_PENDING` 订单设退避（本轮失败的下一轮跳过 N 次），避免对同一批卡死订单每 5 分钟无脑重查。
- 优先级：H（资金收敛链路 + 容量）

### P0-3（M）`usersService.findById` 全量 `include: {account, identity}`，被转账热路径高频调用
- 位置：`src/users/users.service.ts:88-93`，被 `src/transfers/transfers.service.ts:234`（validateParties 内 from/to 两次）调用
- 现状：`findById` 返回 `user + account + identity` 整行；`validateParties` 对 from/to 各调一次 → 一次转账 4 次带 include 的查询。`transfer` 是最高频资金接口。
- 影响（定性）：`identity` 内含**加密身份证号整段**（`idCard`，schema L90-93），但转账只用 `nickname/status/realNameStatus/riskLevel` 与 account 状态。把密文 + 关联表拉进内存再丢弃，属无效传输与反序列化。
- 建议：`findById` 增加可选 `select` 参数或提供 `findByIdLite`；转账路径只用 `select: { id, nickname, status, realNameStatus, riskLevel }` + `include: { account: { select: { id, status } } }`。
- 优先级：M

### P0-4（M）`getFeeIncome` 全量 `findMany` 拉明细再在内存按天累加
- 位置：`src/finance/finance.service.ts:133-185`（L136-151 两个 `findMany`，未 `take` 限制）
- 现状：`paymentOrder.findMany({ where: {status: PAID, paidAt 区间}, select: {fee, paidAt} })` 与 `withdrawalOrder.findMany` 同。跨月/跨年查询时一次性拉**全区间所有订单行**到 Node 内存再 map 聚合。
- 影响（量化）：区间越大越糟；日结单量高时（数万行）内存与网络传输膨胀，且可被一条 `groupBy(['date']) + _sum.fee` 在 PG 侧完成。
- 建议：改 `groupBy({ by: ['xxxDate'], _sum: { fee: true } })` 走 DB 聚合；导出场景（`MAX_EXPORT_ROWS` L55）保留 cap。
- 优先级：M

### P0-5（M）`reconciliation.service` 全量 `findMany` 成功订单 + `in:` 大集合二次查询
- 位置：`src/finance/reconciliation.service.ts:75-81`（`transactionOrder.findMany` 当日全量 SUCCESS 订单）、`270-273`（`accountLedger.findMany({ where: { transactionId: { in: ids } } })`，`in` 集合=全部订单）
- 现状：日终对账把当日**全部成功订单**拉到内存，再拿全量 id 做 `in` 反向查账本。
- 影响（定性）：单日订单量高时 `in` 列表过长（PG 参数上限/plan 退化），内存占用随业务线性增长。
- 建议：
  1. `findMany` 改 `groupBy`/`_count` 或分页 `cursor` 流式处理。
  2. `in: ids` 改反向：用 `accountLedger.groupBy({ by: ['type'], _sum })` 与期望值比对，避免逐 id 反向匹配；或分批 `in`（500/批）。
- 优先级：M

### P0-6（M）`batch-transfers` 收尾/恢复路径全量 `findMany` items
- 位置：`src/batch-transfers/batch-transfers.service.ts:421`（`batchTransferItem.findMany` 全部明细）、`870`、`300`（`for` 逐笔 `processItem`）
- 现状：单批上限 500 笔（`MAX_BATCH_TRANSFER_ITEMS` L33），`resumeProcessing`/`cancel` 全量拉 500 条明细 + 逐笔独立事务。
- 影响（定性）：500 笔串行独立事务，每笔 1 事务 ~ 5-10 SQL，最坏 5000 次往返；崩溃恢复时重复放大。
- 建议：`findMany` 用 `take` 分批；可考虑批量校验收款人（一次 `user.findMany({ where: { id: { in: toUserIds } } })` 预取，去 N+1）。
- 优先级：M

---

## 2. 热点路径（充值回调 / 自动补单 / 转账资金操作）

### P0-7（H）充值入账 `applyRechargeSuccess` 事务内 6 次串行写 + 1 次读，含 `journalService` 再发 2 次
- 位置：`src/transactions/transactions.service.ts:298-364`、`src/finance/journal.service.ts:40-64`
- 现状：一个 `$transaction` 内顺序执行：`account.findUnique`→`account.update`→`order.update`→`ledger.create`→`bill.create`→`journalService.createEntries`（内部 `journalEntry.createMany` + 按账户 `platformAccount.update`）。共 6+ 次独立往返，全部串行 await。
- 影响（量化）：每笔充值到账约 **8~10 次 DB 往返**；高峰期到账 QPS 受此串行链路限制。锁 `recharge:callback:{orderNo}` TTL 30s（L197），单事务越长锁占用越久。
- 建议（不改语义，仅降往返）：
  1. `journalEntry.createMany`（L40）已是批量，保留；但 `platformAccount.update` 在 `for` 循环内逐个 await（L58-64），可 `Promise.all` 并行（账户码去重后通常 1~3 个）。
  2. `account.findUnique`（L309）与 `account.update`（L314）可合并为带 `availableBalance` 条件的一次 `updateMany` + 回读（与转账路径一致），减少 1 次读。
- 优先级：H

### P0-8（H）转账 `moveFundsAndRecord` 内 2 笔 `ledger.create` + 2 笔 `bill.create` + 2 次账户更新串行
- 位置：`src/transfers/transfers.service.ts:280-443`
- 现状：扣款方 `account.updateMany`（L330）→重读（L345）→收款方 `account.update`（L355）→订单 create→`accountLedger.create ×2`（L382/395）→`bill.create ×2`（L408/419）→大额 `riskEvent.create`。
- 影响（量化）：一次转账约 **8~9 次 DB 往返**串行。`accountLedger.create ×2` 与 `bill.create ×2` 彼此无依赖，可并行。
- 建议：
  1. `ledger.create ×2`、`bill.create ×2` 改 `createMany` 或 `Promise.all`（同一事务内并行写不同行无冲突）。
  2. 扣款方重读（L345）可去掉：`updateMany` 不返回新余额，但本事务内已读 `fromAccount`（L311），`balanceBefore = fromAccount.availableBalance - amount` 即可，省 1 次读（需确认无并发——已有锁 + 条件守卫兜底）。
- 优先级：H

### P0-9（M）`transfer`/`agentTransfer` 锁粒度为「整用户」，同用户多笔转账完全串行
- 位置：`src/transfers/transfers.service.ts:46-49`（锁 key `transfer:user:{fromUserId}` 或 idem key）
- 现状：无幂等键时锁 `transfer:user:{fromUserId}`，同用户并发多笔（不同收款人）被串行；持锁 30s，临界区含 bcrypt 验密（L59，`BCRYPT_SALT_ROUNDS=12` ≈ 250-300ms）+ 风控 + 事务。
- 影响（定性）：单用户高频转账时尾延迟被锁放大；这是**为防透支**有意设计（可接受），但 30s TTL 远超实际临界区（~1s），看门狗每 10s 续期。
- 建议（权衡）：锁 key 细化到 `transfer:user:{fromUserId}:{toUserId}` 可让「同付款方不同收款方」并行；但会削弱「同一付款方并发扣款」的串行保护——**需保留日限额的 `updateMany` 条件守卫（L333）兜底**，故可选优化。优先级 M。
- 权衡：缓存/锁 vs 一致性，此处锁是资金一致性防线，改动需配回归测试。

### P0-10（M）充值回调在锁内做渠道验签 + 全事务，验签 CPU 成本计入锁时长
- 位置：`src/webhooks/webhooks.service.ts:53-74`、`src/transactions/transactions.service.ts:195-197`
- 现状：`verifySignature`（RSA/AES 验签 + 微信 V3 解密，CPU 重）与后续事务都在 `redis.withLock(webhook:recharge:..., 30)` 内；而真正资金事务 `transactionsService.handleRechargeCallback` **又套了一层** `redis.withLock(recharge:callback:{orderNo}, 30)`（L197）——**两层嵌套锁**，外层锁未释放期间内层再抢锁。
- 影响（定性）：两把不同 key 的锁嵌套持有；若订单号提取为 `hash:` 兜底（`extractOrderNo` L305-324，微信全走 hash），外锁 key 高度分散但内锁 key 仍 `orderNo`，嵌套本身不冲突，但**验签被计入外锁 30s 预算**，验签+解密慢时挤压资金事务窗口。
- 建议：验签移到**锁外**（验签是无状态纯计算，幂等靠 DB 终态守卫），锁内只做幂等 + 资金事务；同时合并双层锁为单层（外锁 key 与内锁 key 对齐或取消外锁）。`[待核实]`：需确认并发同 orderNo 时内层锁是否仍必要。
- 优先级：M

---

## 3. 外部调用（Stripe/支付宝/微信、LLM、Redis、重试/超时/并发上限）

### P0-11（M）渠道连接器 `timeout: 30_000` + `maxRetries: 2`，但**无全局并发上限**
- 位置：`src/payment-channels/connectors/wechat-pay.connector.ts:35-40`、`stripe.connector.ts:232-233`、`alipay.connector.ts:34-35`
- 现状：每个连接器 `timeout=30s`、`retryConfig.maxRetries=2`（`baseDelay 500ms / maxDelay 5000ms`）。`ConnectorRouter` 仅对**带幂等键**请求启用重试（`payment-channel.bridge.ts:103-105`），这点做得好。但**没有任何出站 HTTP 并发闸**。
- 影响（定性）：兜底扫描（P0-2，200 笔并发化后）+ 正常充值高峰可同时触发数十上百出站渠道请求，渠道限流/宕机时**重试风暴**无熔断。
- 建议：出站加信号量（`p-limit` 或 BullMQ 队列）限制并发；对连续失败渠道做**熔断**（half-open 探测）。`[待核实]`：当前是否已有健康感知降级（`connector-health.service.ts`）。
- 优先级：M

### P0-12（M）LLM `timeoutMs` 默认 30s，但 `sendMessage` 全串行且 `maxSteps=20` 工具循环可能长尾
- 位置：`src/agent/llm/llm.service.ts:156`（`AbortSignal.timeout(this.config.timeoutMs)`）、`src/agent/agent.service.ts:159-205`（`MAX_TURNS=20`）
- 现状：单次 `llm.chat` 超时 30s；但 `generateText` `maxSteps=10`（L153，工具循环内每步一次 LLM 调用），`sendMessage` 又 `maxSteps=MAX_TURNS=20`（L204）。多轮工具调用时**实际墙钟可远超 30s**（30s 是每步超时，非整体）。失败才降级 mock。
- 影响（定性）：Agent 对话接口尾延迟不可控；`@modelcontextprotocol/sdk` + Vercel AI SDK 每轮重新组装 messages（`agent.service.ts:179-198`，取 30 条历史全量重传）。
- 建议：给整体 `sendMessage` 加**总时长上限**（如 60s），工具循环间做 token/步数熔断；历史改增量 + 摘要（RAG）。
- 优先级：M

### P0-13（L）Redis `maxRetriesPerRequest: 3` + `retryStrategy` 无限重连，资金锁降级策略需确认
- 位置：`src/redis/redis.service.ts:75-78`
- 现状：ioredis `retryStrategy` 指数退避上限 2000ms、`maxRetriesPerRequest: 3`。`withLock` 在 dev 无 Redis 时**静默降级无锁**（L252-257），prod 抛错（fail-closed，正确）。
- 影响（定性）：3 次请求重试 + 无限后台重连是合理默认；关键是**确认 prod 锁降级绝不可能发生**（已抛错，OK）。
- 建议：无需改；但 `slidingWindowRecord`（L366-383）用 `multi().exec()` 非事务（非 MULTI/WATCH），高并发下 `zremrangebyscore + zadd + pexpire` 非严格原子——窗口限流计数有轻微竞态（漏计/多计 1 次），风控场景可接受，标注 L。
- 优先级：L

---

## 4. 前端 / 接口（首包体积 + 全量序列化）

### P0-14（M）web-admin 首包把 `echarts`（~1MB）整包打入
- 位置：`web-admin/package.json:21`（依赖 `echarts ^6.1`）；`web-admin/vite.config.ts` 无 `build.rollupOptions` 分包/动态 import
- 现状：`echarts` 全量 bundle 进主包；`web-admin` 未配置 `manualChunks` 或路由级 `() => import(...)`。
- 影响（量化）：echarts UMD 全量 gzip 后常见 300~400KB，直接抬高 TTI。
- 建议：
  1. `echarts/core` + 按需 `register(...)` 注册用到的 chart/组件，替代 `import * from 'echarts'`。
  2. 图表组件用 `defineAsyncComponent(() => import('./Xxx.vue'))` 路由级分包。
  3. vite `build.rollupOptions.output.manualChunks` 拆 `element-plus`/`echarts`/`vue-vendor`。
- 优先级：M

### P0-15（L）web-h5 已做 ElementPlus 按需（good），但 `axios` 全量 + 无分包配置
- 位置：`web-h5/vite.config.ts:43-46`（仅 `outDir`）、`web-h5/package.json`
- 现状：h5 侧已 `unplugin-vue-components` 按需（L17），但未配 `manualChunks`，`axios`/`dayjs` 进主包。
- 建议：加 `manualChunks` + 关键路由 `defineAsyncComponent` 懒加载。
- 优先级：L

### P0-16（M）部分列表接口无 `select` 裁剪，整行返回
- 位置：`src/bills/bills.service.ts:16-20`（`bill.findMany` 无 `select`，但 `take: 50` 有 cap，OK）；`src/withdrawals/withdrawals.service.ts:245-249`（`findByUser` 全量无 cap 无 select）；`src/red-packets/red-packets.service.ts:603/611`
- 影响（定性）：`withdrawals.findByUser` 无分页/上限，用户历史提现多时全量返回 + 逐条 `decrypt`（L251-262，AES 解密 CPU）。
- 建议：加 `take` + `select` 裁剪 + 分页；脱敏 `mask` 仅取必要字段。
- 优先级：M

---

## 5. 缓存（Redis 用途 / 可量化命中率 / 缺热数据缓存）

### P0-17（M）渠道配置 `getEnabledConfig` / `getChannelByType` 每笔交易都查 DB，无缓存
- 位置：`src/payment-channels/payment-channel.registry.ts:60-127`（`paymentChannelConfig.findUnique/findMany`）
- 现状：`recharge`（L88）、`handleRechargeCallback`（L194）、`reconcile`（L399）、`approve`（L277）等**每条资金请求**都实时查 `PaymentChannelConfig` 并 `JSON.parse + 解密`。该表变更极低频（管理员改渠道才动）。
- 影响（量化）：每笔充值 = 1 次 DB 查 + 1 次 AES 解密（`decryptConfigValues`）；高峰期纯浪费。
- 建议：渠道配置加进程内 TTL 缓存（如 60s，仿 `risk-engine` 的 `ruleCache` 模式 `risk-engine.service.ts:126-163`）；管理员改配置时 `clearCache`。**投入极小，见效直接**（见第 9 节）。
- 优先级：M（性价比最高）

### P0-18（M）风控规则缓存已做（good），但 IP 黑名单缓存「读多写多」边界
- 位置：`src/risk/risk-engine.service.ts:393-416`（`ipBlacklistCache`，60s TTL）
- 现状：IP 黑名单 60s 缓存 OK；但 `slidingWindowCheck`（每次 IP 请求 1 次 ZSET 清理+计数）在 `ip_frequency` 规则下每笔交易 2 次 eval（check + record）。
- 影响（定性）：Redis 已是瓶颈时的放大点。`recordTransaction` 在**事务提交后 fire-and-forget**（`transfers.service.ts:101-111`），正确避免拉长事务（good）。
- 建议：高频 IP 的 `slidingWindowCount` 可本地 1s 微缓存降 Redis 压力；其余保持。
- 优先级：M

### P0-19（L）`systemConfig` 限额键每次事务读，无缓存
- 位置：`src/transfers/transfers.service.ts:259`、`src/withdrawals/withdrawals.service.ts:134`、`src/batch-transfers:160`
- 现状：`transfer_daily_limit`/`withdrawal_daily_limit` 等在事务内 `findUnique`。限额低频变更。
- 建议：限额值进 60s 进程缓存（与渠道配置同机制），事务内直接读缓存。需保证改限额后及时失效。
- 优先级：L

---

## 6. CI 构建（Jest ESM 全量 + tsc + Prisma generate）

### P0-20（H，工程/容量）单测 `test:cov` 全量 85 套件串行-ish + 覆盖率门禁，弱机尾风险
- 位置：`jest.config.js`（`maxWorkers:'50%'`、`testTimeout:15000`、`transformIgnorePatterns` 放行 30+ 个 ESM 包）、`package.json` L27-30
- 现状：
  - `transformIgnorePatterns` 放行 `@modelcontextprotocol|zod|@opentelemetry|@prisma|rxjs|...` 等（`jest.config.js` L 中段），ts-jest 全量转译这些 ESM 传递依赖 → **每次跑全量都重新编译**，慢。
  - `maxWorkers: '50%'` 在 2 核 CI runner 上只有 1 worker → 85 套件近乎串行。
  - `test:cov` 开 `lcov + html`（L `coverageReporters`），覆盖率收集额外 2~3× 时间。
- 影响（量化）：这是 **CI 最贵的一步**；弱机/高并发 runner 下偶发 > 默认 5s 用例已放宽到 15s（L `testTimeout`），但**全量墙钟**可能数十分钟。
- 建议（不改语义，纯提速）：
  1. **CI 分 job 并行**：单测按模块拆分 `jest --projects`/`--testPathPatterns` 成 3~4 个 `strategy.matrix` 并发 job（当前 `ci.yml:72-73` 是单 job 跑全量）。
  2. 覆盖率与正确性**解耦**：日常 PR 只跑 `npm test`（无 coverage），`coverageThreshold` 门禁放到**周/主分支合并**专用 job。省 2~3× 时间。
  3. 对 `transformIgnorePatterns` 里纯运行时（无需 ts 转译）的包用 `jest-serializer`/预编译，减少 ts-jest 编译面。
  4. 加 **jest 缓存 + Turborepo/changesets 增量**：`affected` 检测，只跑改动模块。
- 优先级：H（工程容量，但不影响生产资金路径）

### P0-21（L）e2e 单套件 ~10min 弱机风险（qa-engineer 已标 L 级）
- 位置：`test/jest-e2e.config.js`（`maxWorkers:'50%'`、`testTimeout:30000`）、`ci.yml:104-105`（单 job 跑全部 e2e `--passWithNoTests`）
- 现状：5 个 e2e 套件同 job 串行，单套件弱机易逼近 10min。
- 建议：`ci.yml` e2e 拆 matrix（每套件一个 job，并发跑），或 `--maxWorkers=2` 限并发；设 `timeout-minutes` 防挂死。
- 优先级：L

---

## 7. 瓶颈优先级汇总表

| # | 问题 | 位置(文件:行) | 影响(量化/定性) | 优化方案 | 优先级 |
|---|------|---------------|------------------|----------|--------|
| P0-1 | 风控日计数 `count/aggregate` OR 全量扫，缺复合索引 | risk-engine.service.ts:438-467 | 每笔交易 2 次 OR 全量聚合；高频用户放大 | 加 `[fromUserId,createdAt,status]`/`[toUserId,createdAt,status]` 复合索引；或读 `DailyLimitUsage` 缓存 | H |
| P0-2 | PENDING 兜底扫描逐笔串行外呼 200 笔 | transactions.schedule.ts:81-112、service:376-474 | 200 笔串行渠道查单，最坏 ~200s >> 5min cron；积压 | 渠道配置外提 1 次查；查单 `p-limit(20)` 并发；`STILL_PENDING` 退避 | H |
| P0-3 | `findById` 全量 `include:{account,identity}` 拉密文 | users.service.ts:88-93（transfers:234 调 4 次） | 转账热路径 4 次带 include，含加密身份证整段 | 提供 `select` 裁剪版 `findByIdLite` | M |
| P0-4 | `getFeeIncome` 全量 `findMany` 内存聚合 | finance.service.ts:133-185 | 区间越大内存/传输越膨胀 | 改 `groupBy + _sum` DB 聚合 | M |
| P0-5 | 日终对账全量订单 + `in:` 大集合 | finance/reconciliation.service.ts:75-81、270-273 | 单日订单高时 `in` 退化、内存线性增长 | 改 `groupBy`/`_count`；`in` 分批 500 | M |
| P0-6 | 批量转账收尾/恢复全量明细 + 逐笔事务 | batch-transfers.service.ts:300、421、870 | 500 笔串行独立事务 ~5000 次往返 | `take` 分批；预取收款人 `findMany(in)` 去 N+1 | M |
| P0-7 | 充值入账事务 6+ 次串行写 | transactions.service.ts:298-364、journal:40-64 | 每笔到账 8~10 次串行往返 | `platformAccount.update` 并行；合并 find+update 省 1 读 | H |
| P0-8 | 转账 `moveFundsAndRecord` 8~9 次串行往返 | transfers.service.ts:280-443 | 每笔转账 ~9 次串行 | `ledger/bill` 改 `createMany`/`Promise.all`；去扣款方重读 | H |
| P0-9 | 转账锁粒度整用户，同用户多笔串行 | transfers.service.ts:46-49 | 单用户高频尾延迟被 30s 锁放大 | 锁 key 细化 `:toUserId`（保留 updateMany 条件兜底） | M |
| P0-10 | 回调验签在锁内 + 双层嵌套锁 | webhooks.service.ts:53-74、transactions:195-197 | 验签 CPU 计入 30s 锁预算 | 验签移锁外；合并双层锁 | M |
| P0-11 | 出站渠道 30s/2retry，无并发闸/熔断 | wechat-pay.connector.ts:35-40 等 | 渠道故障时重试风暴无上限 | 出站信号量 `p-limit` + 熔断 half-open | M |
| P0-12 | LLM 30s/步 超时，`maxSteps=20` 总时长不可控 | llm.service.ts:156、agent.service.ts:159-205 | Agent 对话墙钟长尾；历史全量重传 | 加整体 60s 上限；历史 RAG/增量 | M |
| P0-13 | Redis `slidingWindowRecord` `multi` 非严格原子 | redis.service.ts:366-383 | 高频 IP 限流漏/多计 1 | （可接受）标注；需严格则改 `WATCH`/Lua | L |
| P0-14 | web-admin `echarts` 全量进首包 | web-admin/package.json:21、vite.config.ts | TTI +300~400KB | echarts 按需 `register`；路由懒加载；`manualChunks` | M |
| P0-15 | web-h5 无分包，`axios/dayjs` 进主包 | web-h5/vite.config.ts:43-46 | 首包偏大 | `manualChunks` + 关键路由懒加载 | L |
| P0-16 | 列表接口部分无 `select`/上限 | withdrawals.service.ts:245-249 | 历史多则全量 + 逐条 AES 解密 | 加 `take`/`select`/分页 | M |
| P0-17 | 渠道配置每笔交易实时查 DB + 解密 | payment-channel.registry.ts:60-127 | 每笔 1 次查 + AES 解密纯浪费 | 渠道配置 60s 进程缓存 + 改配置失效 | M |
| P0-18 | 风控 Redis ZSET 每笔 2 次 eval | risk-engine.service.ts:419-436 | Redis 高频放大 | 高频 IP `count` 加 1s 本地微缓存 | M |
| P0-19 | 限额 `systemConfig` 每事务读 | transfers:259、withdrawals:134 | 低频键高频读 | 限额进 60s 进程缓存 | L |
| P0-20 | 单测全量 85 套件 + coverage 同 job | jest.config.js、package.json:27-30、ci.yml:72-73 | CI 最贵一步，弱机数十分钟 | 模块矩阵并行；coverage 解耦；增量 `affected` | H |
| P0-21 | e2e 单套件 ~10min 同 job 串行 | test/jest-e2e.config.js、ci.yml:104-105 | 弱机逼近 10min | matrix 拆分/限 worker/timeout-minutes | L |

---

## 8. 容量规划（目标 + 扩缩容策略）

- 现状连接池：`DATABASE_CONNECTION_LIMIT` 默认 5、`statement_timeout` 30s、`pool_timeout` 10s（`prisma.service.ts:29-42`）。多副本部署时按 `PG max_connections / 副本数` 调 `DATABASE_CONNECTION_LIMIT`（已有注释，good）。
- 瓶颈排序下的容量抓手：
  1. **DB 往返数**（P0-7/P0-8）：到账/转账是资金写放大主源。优化后单事务往返从 ~9 降到 ~5，PG 连接与 QPS 上限近似 ×1.8。
  2. **出站并发**（P0-11）：加出站信号量后，渠道故障不再级联打爆本服务，水平扩副本时出站并发随之线性可控。
  3. **CI 容量**（P0-20）：单测矩阵化 + coverage 解耦，CI 墙钟从「全量数十分钟」降到「矩阵并行 ~10min」，弱机风险解除。
- 扩缩容策略：
  - **DB**：先做 P0-1 复合索引 + P0-7/P0-8 往返削减，再压测；目标 P99 < 200ms（到账事务）。
  - **出站**：P0-11 信号量 + 熔断后，按渠道配额设上限，副本数与渠道 QPS 上限联动。
  - **Redis**：P0-18 本地微缓存降 ZSET 压力；ioredis `maxRetriesPerRequest:3` 保持。
  - **CI**：P0-20 矩阵 + 增量，PR 仅跑 `npm test`，主分支才跑 `test:cov`。

---

## 9. 三条「最高性价比」优化项（投入小、见效大）

1. **【P0-17】渠道配置进程内 60s 缓存**
   - 改 `PaymentChannelRegistry.getEnabledConfig/getChannelByType`：仿 `risk-engine` 已有 `ruleCache`（60s TTL + `clearCache`），命中直接返回；管理员改渠道时调 `clearCache`。
   - 投入：~40 行；收益：每笔充值/回调/补单省 1 次 DB 查 + 1 次 AES 解密，**资金热路径直接提速**，零语义风险（配置低频变更）。

2. **【P0-20】CI 单测提速：coverage 与正确性解耦 + 模块矩阵并行**
   - `ci.yml`：PR 用 `npm test`（无 coverage），`coverageThreshold` 门禁挪到主分支专用 job；单测按模块拆 `strategy.matrix`（3~4 个 `--testPathPatterns` 并发 job）。
   - 投入：改 `ci.yml` + `package.json`（无代码改动）；收益：CI 墙钟从数十分钟降到 ~10min，弱机尾风险（qa-engineer L 级）显著缓解。

3. **【P0-1】风控日计数加复合索引 + 复用 `DailyLimitUsage`**
   - 加 `@@index([fromUserId,createdAt,status])` 与 `[toUserId,createdAt,status]`；`getDailyAmount` 改读 `DailyLimitUsage`（已在事务内累加，`users.service.ts:428-438`），免 2 次 OR 全量聚合。
   - 投入：schema 加 2 索引 + 改 1 方法；收益：`riskEngine.check` 每笔交易减 2 次重扫描，**高频用户尾延迟直接下降**，零正确性风险（限额语义不变）。

---

## 10. 遗留风险（H/M/L）

- **H**：P0-11 出站无并发闸/熔断——渠道故障放大；P0-2 PENDING 收敛能力线性退化（积压时补单延迟影响资金到账时效）。
- **M**：P0-7/P0-8 事务往返多（资金写放大）；P0-12 LLM 长尾；P0-14 echarts 首包。
- **L**：P0-13 Redis 窗口限流非严格原子；P0-15/P0-16 前端与列表序列化；P0-21 e2e 弱机。

## 11. 给主理人汇编的 3 个重点

1. **资金写放大是头号性能债**：到账/转账单事务 ~9 次串行 DB 往返（P0-7/P0-8）+ 每笔交易实时查渠道配置（P0-17）——三条最高性价比项里两条直击热路径，建议优先落地。
2. **风控 `riskEngine.check` 是全系统每笔交易必经路径**：其日计数 OR 全量扫（P0-1）是高频用户尾延迟根因，复合索引 + 复用 `DailyLimitUsage` 零风险、收益直接。
3. **CI 是「能最快见效」的工程项**（P0-20）：不动业务代码，仅改 `ci.yml`/`package.json` 即可把全量单测墙钟砍到 ~10min，直接回应 qa-engineer 的弱机 L 级风险。
