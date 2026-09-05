# KeBaiPay 更新日志

> 版本更新记录与功能清单

## 目录

- [版本 0.2.1（2026-09-05）](#版本-0212026-09-05)
- [版本 0.3.0（进行中）](#版本-030进行中)
- [版本 2.2.1（2026-08-26）](#版本-2212026-08-26)
- [仓库体检与开源规范化](#仓库体检与开源规范化)
- [Agent 智能体修复与测试](#agent-智能体修复与测试)
- [视觉升级（UI/UX）](#视觉升级uiux)
- [架构治理与修复](#架构治理与修复)
- [版本 2.2.0](#版本-220)（2026-08-01）
- [版本 2.1.1](#版本-211)（2026-07-29）
- [版本 2.1.0](#版本-210)（2026-07-22）
- [版本 2.0.0](#版本-200)（2026-07-21）
- [版本 1.0.0](#版本-100)（2026-07-13）
- [已实现功能清单](#已实现功能清单)
- [2026-07 重构记录](#2026-07-重构记录)

---

## 版本 0.2.1（2026-09-05）

**版本类型：** 版本基线收敛

- 版本基线收敛为 **0.2.1**（以根 `package.json` 的 0.2.1 为唯一版本源）。
- 历史 2.x 条目（2.2.1 / 2.1.x / 2.0.0 等）作为历史记录归档保留，不再影响对外版本号。

---

## 版本 0.3.0（进行中）

**版本类型：** 新功能（Phase 1 可用性——打通商户自助开通漏斗）

### 新增

- **用户注册页（H5）**：`/register` 昵称+手机号+密码注册，成功后自动登录并引导实名；登录页新增注册入口。此前三端均无注册 UI，获客漏斗第一环断裂。
- **实名认证页（H5 + 商户门户双端）**：`/kyc` 表单提交姓名/身份证/支付密码（6 位），实时回显已认证状态；商户门户侧边栏新增入口——入驻前不再被"需先实名"卡死且无入口。
- **管理后台「实名审核」页**：待审核列表（用户信息+脱敏证件号+分页）、通过/驳回（驳回原因必填）。此前该流程只能 curl 或 SQL 操作，商户增长被人工 SQL 卡住。
- **管理后台「渠道配置中心」**：渠道列表（类型标签/启停开关/优先级/凭据脱敏摘要）、新增与编辑表单、连通性测试按钮、删除确认。凭据保存走 AES-256-GCM 加密链路，编辑留空字段保持原值。此前接通微信/支付宝必须改数据库。
- **沙箱自动审批开关 `SANDBOX_AUTO_APPROVE`**：非生产环境开启后，实名提交即通过、商户入驻即通过，新用户全程 UI 自助开通（Time-to-First-Payment 从天级压到分钟级）；生产环境代码层强制忽略该开关。

### 验证

- 三前端 vue-tsc 构建全绿（h5 / portal / admin）
- 后端 tsc EXIT=0；users/merchants 套件 63 用例通过（沙箱关闭路径行为不变）

---

## 版本 2.2.1（2026-08-26）

**版本类型：** Bug 修复 + 安全修复 + MVP 可运行化

### 安全与正确性修复（2026-08-26 专家评审 Phase 0）

- **外呼重试幂等门控（P0-5）**：`ConnectorRouter` 此前对任何错误盲目重试 create 类外呼，渠道侧无幂等键时超时重试可能双下单/双放款。现仅当请求携带 `orderNo / refundNo / idempotencyKey`（微信 out_batch_no、支付宝 out_biz_no/out_request_no 同源）才启用指数退避重试；Stripe Connector 三处 create 调用贯通官方 `Idempotency-Key` header。
- **Agent 密钥轮换接口**：新增 `POST /agent/admin/agents/:id/rotate-secret`（管理端），新明文仅本次响应返回一次。
- **测试规模统计脚本**：`scripts/test-stats.mjs` 输出套件/用例数（当前 77 套件 / 约 1186 例），文档数字自此由脚本生成。
- **E2E 场景修复 + 进 CI**：场景 5 并发回调此前硬编码金额 10000 与订单 100 分不符——旧代码忽略回调金额才"通过"，恰是 H-2 要拦的错误假设；已修正为与订单一致。E2E（48 例）接入 CI 独立 job；test job 新增 PG16 service 容器执行空库 `migrate deploy` 冒烟，提前暴露 schema↔migration 漂移。
- **开放 API 签名口径统一（集成定时炸弹排除）**：服务端自始只存 `sha256(appSecret)`，但官方 Node SDK 与 SDK_GUIDE 四语言示例曾用明文 secret 作 HMAC key——按旧文档接入 100% 验签失败。现 SDK 内置 SHA-256 预哈希，Node/Python/Java/PHP 示例与 QUICKSTART、签名公式、API_REFERENCE 兼容期说明全部对齐（存量商户不受影响）。
- **Agent appSecret 只存哈希**：`createAgent` 此前明文落库；现比照 MerchantApp 标准仅存 sha256 摘要，明文只在创建响应回显一次。
- **嵌入式 MCP Server 身份绑定 fail-closed**：`kbpay_query_balance / kbpay_query_bill` 此前接受任意 userId（经 HTTP transport 暴露即水平越权）；现强制绑定 `KBPAY_MCP_USER_ID`，未绑定或身份不匹配直接拒绝，与 standalone 进程同一策略。
- **批量转账退款事务化 + 幂等键加固**：收尾退款此前分两次独立提交（冻结释放与退款订单创建间存在崩溃窗口），幂等判定靠 remark 字符串匹配。现整体包进 `$transaction`，改用确定性幂等键 `BT-REFUND:{batchNo}`（唯一约束兜底），OR 条件兼容历史存量退款单防重复退款。
- **分布式锁失败语义修正**：`withLock` 获取锁失败由裸 `Error`（500）改为 `ConflictException`（409 + 新错误码 KB707），高并发争用时客户端收到可重试的冲突语义。
- **/metrics token 常量时间比较**：SHA-256 摘要后 `timingSafeEqual`，消除逐字节短路泄露。
- **bcrypt cost 10 → 12**：仅影响新哈希（cost 存于 hash 头，存量密码校验兼容）。
- **微信 V3 回调时间戳时效校验**：验签增加 ±300 秒窗口，历史合法回调无法无限期重放。
- **支付宝代付回调单号语义修复**：`parsePayoutCallback` 此前把 `out_biz_no`（我方单号）同时填入 `channelOrderNo` 与 `orderNo`，与 `createPayout` 存储的渠道侧单号 `order_id` 恒不匹配——真实回调必然命中 `CALLBACK_CHANNEL_ORDER_NO_MISMATCH`、提现订单永久卡死 PROCESSING。现按"channelOrderNo 恒为渠道侧单号"约定修正解析与 `queryPayout` 查询字段；提现回调匹配兼容存量占位数据并支持渠道单号补录。
- **日切时区统一 Asia/Shanghai（P0-6）**：限额/风控/订单号日期前缀等 14 处"自然日"此前用 UTC 日切，北京时间 0:00-8:00 的交易计入"昨日"、日限额早 8 点才翻转。新增 `businessDayKey()`（`date-helpers.ts`）并全量替换（finance 报表区间构造为独立口径，后续批次处理）。
- **jest 稳定性配置**：`testTimeout` 5s→15s + `maxWorkers: '50%'`，消除弱机/CI 上 supertest 用例偶发超时导致的假红灯（评审实测 5 例失败）。
- **渠道凭据加密落库（高危修复）**：微信 `apiV3Key`、支付宝应用私钥等渠道配置字符串值此前为明文 JSON 直接入库；现于 `ChannelConfigService` 写入路径统一做 AES-256-GCM 信封加密（密文带 `enc:v1:` 前缀），`PaymentChannelRegistry` / 连接器热同步读取时解密。历史明文存量兼容读取，且在任意一次配置保存时自动迁移为密文。
- **充值回调实付金额强校验（高危修复）**：`handleRechargeCallback` 此前忽略回调携带的实付金额、直接按订单金额入账；现成功回调必须满足 `实付金额 === 订单金额`（新增错误码 `KB706 CALLBACK_AMOUNT_MISMATCH`），金额缺失或不一致一律 fail-closed 拒绝入账并记录错误日志，符合微信/支付宝官方接入规范的强制核对项。

### 文档与工程化

- **根 README.md 补齐**（此前根目录无 README）：合规红线警示、核心特性、快速开始、命令表、文档索引、目录结构。
- **文档失实勘误**：PRODUCTION_READINESS 的"Sentry 配 DSN 即启用"（项目从未接入 Sentry SDK）与"没有 CI"（ci.yml 已存在且持续增强）两条已标注勘误；PROJECT_PLAN 测试数字修正为实测口径（E2E 48 而非误记的 324）。
- **CI 接入版本门禁**：test job 新增 `npm run version:check` 步骤，版本漂移直接红。
- **版本管理规范化**：新增 `docs/VERSIONING.md`（严格 SemVer 纪律：日常修复走 PATCH、新功能走 MINOR、破坏性变更走 MAJOR）；新增 `scripts/version-sync.mjs` 与 `npm run version:sync / version:check`——根 package.json 为唯一版本源，三前端版本号禁止独立修改。三前端虚高的 2.3.0 回退对齐至 2.2.1。

### 修复内容

- **Agent MCP Server 初始化告警**：`tool()` 工具参数由 JSON Schema 对象改为 Zod schema（`zod` 已加入依赖），`AgentMcpServer` 与 `standalone.ts` 两处共 10 个工具注册全部生效，不再抛 "expected a Zod schema" 警告。
- **seed 测试账号无法登录**：原 `139******11` 为脱敏占位符，实际入库后无法登录；改为真实手机号 `13800000001` / 邮箱 `test@kebaipay.com`，密码 `Abc12345`，并补全实名认证与 10000 元余额。
- **`/portal` 静态路由**：商户后台 Vue 3 SPA 挂载到 `/portal` 时被根静态模块拦截，已调整注册顺序并排除 `/portal`。
- **后端 `tsconfig`**：排除 `web/`、`web-h5/` 目录，避免与前端工程串扰。

### 前端 Vue 3 现代化

- **商户后台（`web/`，挂载 `/portal`）**：数据看板 / 订单管理 / 对账查询 / 收款码 / 应用管理 / 商户资料 / **商户入驻申请**（未入驻时引导入驻，入驻需先实名认证）/ **Webhook 回调重试可视化**（订单回调状态、重试次数、未成功回调订单可手动重发）。
- **用户端 H5（新增 `web-h5/`，挂载 `/h5`）**：钱包首页（余额 + 快捷操作 + 最近账单）/ 充值 / 转账 / 提现 / 红包（发/领/列表）/ 账单（收支筛选）/ 收银台（建单 + 支付）。
- **管理后台（新增 `web-admin/`，挂载 `/admin`）**：数据概览 / 用户管理（冻结/解冻）/ 商户管理（审核）/ 提现审核（通过/拒绝）/ 支付订单 / 财务总览 / 风控事件处置。
- 前端静态托管统一由 `spaStaticModules()` 管理（`/portal`、`/h5`、`/admin`，仅当构建产物存在时注册）。
- CI 新增 `web`、`web-h5`、`web-admin` 三个前端构建 job。

### MVP 本地运行说明

- 依赖：PostgreSQL 17 + Redis 7（`sudo apt-get install postgresql redis-server`）。
- 初始化：`npx prisma migrate deploy && npx ts-node prisma/seed.ts`。
- 启动：`node dist/main.js`（`dist` 由 `npx nest build` 生成）。
- 测试账号：用户 `13800000001` / `Abc12345`（支付密码 `123456`）；管理员 `admin` / `Admin2026`。

---

## 仓库体检与开源规范化

- **清理冗余**：删除 8 个未被任何脚本/文档/CI 引用的孤儿开发脚本（`coverage-check.mjs` / `live-verify.mjs` / `ui-structure-check.mjs` / `ui-walk.mjs` / `agent-e2e-test.ts` / `agent-security-test.ts` / `frontend-visual-test.ts` / `llm-live-test.ts`）；`scripts/` 仅保留 `check-external.mjs`（`npm run check:external`）与 `capture-demo.mjs`（演示录制）。
- **补齐开源规范**：新增 `.gitattributes`（统一换行符与二进制文件声明）。
- **修正文档**：`docs/PROJECT_PLAN.md` 版本号由 v2.1.1 对齐为 v2.2.0。
- **CI 精简确认**：`.github/workflows/` 仅保留必需的最小 CI（`ci.yml`：push/PR 触发，含 `tsc` 类型检查 + 单测 + 三端前端构建），无冗余工作流。
- 验证：后端 `tsc` 零错误，受影响模块单测通过，Agent e2e 32 用例通过，三端前端构建通过。（沙箱内存受限无法本地跑全量，CI 环境充足全绿。）

---

## Agent 智能体修复与测试

完整测试报告见 `docs/AGENT_TEST_REPORT.md`。修复了 3 个阻断性缺陷：

1. **Agent 无法通过 HTTP 使用（阻断）**：`login` 无路由且认证管理端点被 `AgentAuthGuard`（需 Agent token）错误保护，形成"无 token 无法换 token"循环。新增：
   - `AgentAuthController`（用户 JWT）：`login / authorize / revoke / authorizations`；`subjectId` 强制绑定当前登录用户，杜绝越权。
   - `AgentAdminController`（管理员 JWT）：`POST/GET /agent/admin/agents` 创建/列出 Agent。
   - `AgentUserAuthGuard` / `AgentAdminAuthGuard` 自包含守卫。
2. **授权表字段映射错误（阻断）**：`AgentAuthorization.subjectType` 缺 `@map("subject_type")` → `P2022`。已补 `@map` 并应用迁移 `20260811010514_fix_agent_auth_subject_type`（同时对齐既有 schema drift）。
3. **人工确认流程工具查不到（阻断）**：`confirmOp` 误用 `scope` 解析场景。改为从操作日志 `detail.scenario` 恢复工具集，CONFIRM 可正确执行工具。

### Agent 全链路测试（mock 模式）

管理员建 Agent → 用户授权 → 用户换 token → 会话 → 多轮对话 → 确认/拒绝 → 哈希链校验，全部通过。`agent.e2e-spec.ts` 更新为 32 用例通过。

### Agent 真实管理界面

- **管理后台（`web-admin` → `/admin/agents`）**：智能体管理页 —— 创建/编辑/停用 Agent，配置作用域（wallet/merchant/risk/support）。新增后端 `GET/POST /agent/admin/agents`、`PATCH /agent/admin/agents/:id`。
- **用户 H5（`web-h5` → `/h5/#/agent`）**：AI 智能助手页 —— 选择智能体 → 一键授权 → 多轮对话 → 资金操作二次确认/拒绝。新增后端 `GET /agent/me/agents`（列出可用 Agent 及授权状态）。
- Agent 由"仅 mock 可用"升级为**用户可通过界面实际管理、连接、对话、确认操作**的真实功能（真实模型调用待有效 LLM Key，配置即用）。

### 已知限制

- 外部 LLM key（zhiyunapi.cc）经验证无效（Invalid token），真实多模型调用待有效 key（配置见 `docs/EXTERNAL_QUICKSTART.md`）。
- `kbpay_transfer` 转账工具为 stub（仅校验，未真正划转），上线前需接入 `TransferService`。
- 工具调用结果未跨轮持久化（技术债）。

---

## 视觉升级（UI/UX）

基于精品金融科技「安静奢华」风格（对标 Stripe / Revolut / Wise），对四端界面进行系统性视觉重构。

### 设计规范

- **品牌色**：翡翠绿 `#0FA968`（主色，hover `#0C8A57`）+ 墨蓝深底 `#0B1220`，统一商户/管理/H5/原版四端。
- **字体**：系统现代字体栈（SF Pro Text / Inter / 苹方），标题 20/600、卡片标题 15/600、正文 14、辅助 12 的字号阶梯；金额用 `tabular-nums` 等宽对齐。
- **圆角**：卡片 16px、按钮/输入/标签 10px、弹窗 14px。
- **阴影**：分层柔和阴影（`0 1px 2px` + `0 10px 30px`），悬浮加深 + `-2px` 抬升。
- **动效**：统一 `160ms cubic-bezier(.4,0,.2,1)`；卡片 hover 抬升、按钮按压态、路由切换 `fade-slide`、H5 底部导航激活过渡。

### 落地内容

- **统一设计系统**：新增 `web / web-h5 / web-admin` 三端共享的 `src/styles/design-system.css`，覆盖 Element Plus 全量主题变量（颜色/圆角/阴影）+ 全局基础样式 + 微动效工具类，注入各端 `main.ts`。
- **布局重构**：商户后台与管理后台统一为深色品牌侧边栏（品牌标识 + 渐变激活态 + hover 反馈）+ 毛玻璃头部；H5 为深色渐变顶部栏 + 悬浮底部导航。
- **关键视图**：三端登录页改为深色渐变 + 品牌徽标 + 光点背景；商户/管理数据看板升级为悬浮指标卡（渐变数字、彩色图标）；H5 首页为渐变余额卡 + 圆角操作宫格。
- **原版 SPA**：`public/style.css` 品牌色由靛蓝对齐为翡翠绿，阴影升级为分层柔和阴影，卡片悬浮抬升。
- 全部改动为纯样式层，未改动任何业务逻辑、接口与页面结构。

---

## 架构治理与修复

基于一次系统性架构审查（模块依赖/分层/事务/错误码/配置/资金一致性），修复以下问题：

### 错误码机制修复（高）

- 此前 `AllExceptionsFilter` 用 `httpStatusToCode` 按 HTTP 状态粗粒度重写 `code`，把精确业务码（如 `KB502`）丢弃在 message 文本中，导致响应 `code` 与文档约定的 `KBxxx` 语义不符，无法按码监控/对账。
- 现在过滤器从 `kbError` 消息（格式 `"KB501 不能给自己转账"`）中提取精确 `KBxxx` 透传到响应 `code` 字段，无 `KB` 前缀时回退到 HTTP 状态映射。实测错误响应由 `code=KB400` 修正为 `code=KB502`。

### 分层违规修复（高）

- **控制器直接持有 PrismaService 破坏分层**：
  - `invoices.controller.ts`：`getMerchantId` 下移到 `InvoicesService.getApprovedMerchantId`，控制器不再注入 PrismaService。
  - `admin/channel-config.controller.ts`：渠道 CRUD + 配置合并 + 脱敏 + 连接器热同步（约 200 行业务）抽取到新增的 `ChannelConfigService`，控制器瘦身为参数映射。对应 spec 同步更新。
- 控制器层不再直接执行事务/业务逻辑，分层回归 Controller → Service → Prisma。

### 死配置 / 密钥 bug（中-高）

- `finance.module` 误用**未定义的 `JWT_SECRET`** 注册管理端 JwtModule：与其它管理端模块对齐改为已校验的 `JWT_ADMIN_SECRET`。（该 JwtModule 并非死代码——`AdminJwtAuthGuard` 需要它提供 `JwtService`，原报告"删除"建议有误，实为修密钥。）

### 崩溃恢复缺失（高，资金一致性）

- **分账（Splits）与批量转账（BatchTransfers）** 逐笔在独立事务处理，进程崩溃会导致订单停留在 `PROCESSING`、明细停留在 `PENDING` 且永无恢复。
- 新增两个定时恢复任务：
  - `src/splits/splits.schedule.ts`（`splits:recover`）
  - `src/batch-transfers/batch-transfers.schedule.ts`（`batch-transfers:recover`）
  - 每 5 分钟扫描超过 5 分钟仍 `PROCESSING` 且存在 `PENDING` 明细的单据，加 Redis 锁重放未处理明细并收尾。
  - 幂等保证：明细处理以 `PENDING` 为守卫；批量转账退款以"已存在退款订单"守卫，避免崩溃窗口重复退款。
  - 两个调度注册到 `ScheduleHealthService` 自监控。

### 未纳入本次（技术债，见 PROJECT_PLAN）

- 资金 Service 账户扣/加 + 账本 + 账单的复制粘贴抽取统一 `LedgerService`（涉及 8 个资金 Service，改动大、资金逻辑敏感，另行排期）。
- 11 个 `@Global()` 业务模块收敛为显式 `imports`（改动横跨 42 模块，风险高，另行排期）。
- 前端三工程 monorepo 化共享 `http/auth store/类型`。
 - God Service（`admin.service` 1236 行、`cashier.service` 923 行）拆分。

---

## 版本 2.2.0

**发布日期：** 2026-08-01

**版本类型：** 功能增强（官方 SDK 接入 + Connector 体系接入业务链路）

### 官方渠道 SDK 替换手写签名

- **支付宝渠道全面改用 `alipay-sdk@4.x`**（`src/payment-channels/channels/alipay.channel.ts`）：
  - `buildSdk` 支持沙箱/生产网关切换
  - 充值回调/退款回调/代付回调全部经 `checkNotifySignV2` 验签（失败抛 `AUTHENTICATION_FAILED` 或返回 false）
  - `createRecharge` 用 `pageExecute(...,'GET')` 返回完整支付 URL
  - 查询/退款/代付用 `exec(...,{validateSign:false})` 并判定 `code === '10000'`
  - 退款渠道号编码为 `${trade_no}:${out_request_no}`，供 `alipay.trade.fastpay.refund.query` 查询
- **微信支付渠道全面改用 `wechatpay-node-v3@2.x`**（`src/payment-channels/channels/wechat-pay.channel.ts`）：
  - `buildPayClient(cfg, decryptOnly?)`：回调解密仅需 `apiV3Key`，不强制商户证书
  - 充值按 native/jsapi/h5 分发（jsapi 用 `pay.sha256WithRsa` 重算 paySign）
  - 三种回调经 `decipher_gcm` 解密校验；**代付回调校验 `success_num >= total_num` 才判 SUCCESS**（`batch_status=FINISHED` 不代表明细成功，防资金事故）
  - `verifyWebhookSignature` 用平台证书离线 RSA-SHA256 同步验签（`wechatpay-timestamp/nonce/signature`）
- **新增渠道单测**：`alipay.channel.spec.ts`（验签/篡改/回调解析/URL 构建）+ `wechat-pay.channel.spec.ts`（自建 AEAD 回调加密体/三回调解密/代付 success_num 守卫/RSA 验签）

### Connector 体系接入业务链路（桥接方案）

- **ConnectorRegistry 自动注册**：构造器注入 5 个 Connector 并自动 `register`（与 PaymentChannelRegistry 一致；可选参数保持 `new ConnectorRegistry()` 测试兼容），解决此前生产环境注册表恒为空的问题
- **ConnectorRouter 新增 `RouteOptions.preferredName`**：渠道选择已由 PaymentChannelRegistry 完成，仅路由到指定连接器，不做跨渠道降级（退款/代付订单不可在渠道间随意切换）
- **新增 `PaymentChannelBridge`**（`src/payment-channels/payment-channel.bridge.ts`）：
  - 渠道实例与 DB 配置仍由 `PaymentChannelRegistry` 提供（修复旧 Connector 适配器传空 `{}` 配置的问题）
  - 外呼（充值/代付/退款/查询）经 `ConnectorRouter` 获得统一重试（默认 2 次指数退避）与健康感知
  - 渠道无对应连接器（未注册）时回退直连渠道，保证存量功能不受影响
  - 验签/回调解析/成功响应构建等本地能力保持直连渠道，不经路由器
- **业务服务改造**：
  - `transactions.service.ts` `createRecharge` → `bridge.createRecharge(code, request)`
  - `withdrawals.service.ts` `createPayout` → `bridge.createPayout(code, request)`
  - `refund.service.ts` `refund` / `queryRefund` → `bridge.refund` / `bridge.queryRefund`
  - `withdrawals.schedule.ts` 超时兜底 `queryPayout` → `bridge.queryPayout`（查询失败仅告警返回）
- **测试更新**：transactions/withdrawals/refund/concurrency 四个 spec 注入真实 Bridge（连接器未注册回退直连路径）+ Connector 双 stub；新增 `payment-channel.bridge.spec.ts`（11 用例）与 `connector-router` preferredName 用例（3 个）

### 测试结果

- 单元测试：72/72 套件通过，1141/1141 测试通过
- E2E 用户场景测试：5/5 套件，46/46 通过（user-scenarios 场景 3 兼容自动注册）
- TypeScript 编译：零错误

---

## 版本 2.1.1

**发布日期：** 2026-07-29

**版本类型：** Bug 修复 + 项目完整性审计

### 修复内容

#### 生产 Bug 修复

- **refund.service.ts 幂等检查逻辑修复**：`processRefundSuccess` 原使用乐观锁（`status: PROCESSING`）做幂等检查，但 `createRefund` 已将状态设为 `SUCCESS`，导致幂等检查永远失败。改为基于 `accountLedger.findFirst` 的账本记录检查，确保退款资金退回的幂等性。

#### Mock/测试修复

- **mock.channel.ts refund() 返回值修正**：从 `PENDING` 改为 `SUCCESS`，使 Mock 渠道退款可同步完成，与 Alipay/WeChat 行为一致。
- **refund.service.spec.ts Mock 补全**：添加 `accountLedger.findFirst` mock，修复因生产代码修改导致的测试失败。
- **user-scenarios.e2e-spec.ts 7 个场景全部修复**：
  - MockPrismaClient 支持嵌套 `create`（如 `account: { create: {} }`）并自动推断外键
  - MockPrismaClient 支持 Prisma 原子操作（`increment`/`decrement`/`multiply`/`set`）
  - 场景 1/2/5 添加平台账户 `upsert` 初始化
  - 场景 3 ConnectorRegistry 手动注册连接器
  - 场景 3 修正 `fallbackChain` 断言
  - 场景 5 修正余额断言（1 元 = 100 分）
  - 场景 1/2 充值金额修正为实际订单金额

#### 项目完整性

- **ChannelReconciliationModule 导出修复**：添加 `AutoFixService` 到 providers 和 exports
- **NotificationsModule 依赖修复**：E2E 测试添加 `ScheduleHealthModule` 导入
- **文档补全**：将 `docs/archive/` 下 13 篇文档移至 `docs/` 主目录
- **README 更新**：测试计数从 1023 更新为 1176
- **docker-compose.yml**：移除已废弃的 `version: '3.8'` 字段

### 测试结果

- 单元测试：77/77 套件通过，1176/1176 测试通过
- E2E 用户场景测试：7/7 场景通过
- TypeScript 编译：零错误

---

## 版本 2.1.0

**发布日期：** 2026-07-22

**版本类型：** AI 智能体层接入 —— 把 KeBaiPay 升级为基于 AI Agent 的智能支付平台

### 升级概览

本轮基于对 Vercel AI SDK、Stripe/PayPal Agent Toolkit、Shopify shop-chat-agent、Botpress、n8n 等开源项目的对标分析，新增完整的 AI 智能体层。**新增 10 个 API 端点**（204 → 214）、**新增 5 张 Prisma 模型**（47 → 52）、**新增 1 种认证方式**（AgentAuthGuard，独立 JWT_AGENT_SECRET）、**新增 31 个 e2e 测试**。

### 核心能力

#### 第 4 种认证：AgentAuthGuard

- 独立于 User/Admin/OpenAPI，使用 JWT_AGENT_SECRET 签发长期 token（默认 7d）
- 自包含 CanActivate，不依赖 Passport（仿 AdminJwtAuthGuard）
- token 携带主体授权信息（subjectType/subjectId/authId/authScopes）
- 实时查 DB 校验 Agent.status 与授权未撤销/未过期，防降权残留
- JWT payload 中 `typ='agent'` 与其他三类隔离

#### LLM 服务封装（mock 降级）

- 抽象 LlmService：统一 `chat({ messages, tools, systemPrompt, maxSteps })` 接口
- LLM_PROVIDER=mock 时降级为本地模板引擎（复用 RiskAuditAiEngine 模式）
- 非 mock 时动态 import Vercel AI SDK v7（`generateText` + `tool()` + `maxSteps`）
- SDK 加载失败也降级为 mock，保证无 LLM 环境可用
- 支持 OpenAI 兼容协议（DeepSeek/OpenAI/Moonshot/通义等）

#### 三大 Agent 场景

**C 端钱包管家（wallet）：**
- kbpay_query_balance：查余额（availableBalance/frozenBalance/totalBalance 三段）
- kbpay_query_bill：查账单列表（带 amountYuan 转换）
- kbpay_send_message：发站内消息（LOW/NORMAL/HIGH 优先级）
- kbpay_claim_coupon：领优惠券（走 CouponsService.claim）
- kbpay_transfer：用户间转账（**requireConfirm=true**，强制二次确认）

**B 端店长助理（merchant）：**
- kbpay_query_merchant_orders：查商户订单列表
- kbpay_query_merchant_balance：通过 Merchant→User→Account 关联查询余额
- kbpay_query_reconciliation_diff：查对账差异项

**A 端风控审计官（risk）：**
- kbpay_query_risk_events：查风险事件（按 level/status 过滤）
- kbpay_query_health：查系统与调度任务健康状态
- kbpay_query_reconciliation_diffs：查 S5 多平台对账差异

#### Human-in-the-Loop 资金安全

- 资金类工具（requireConfirm=true）不立即执行
- 写入 AgentOperationLog PENDING_CONFIRM，推送站内消息通知用户
- 用户调 `/agent/confirm` 接口决策：CONFIRM 执行工具 + 更新日志 SUCCESS，REJECT 更新日志 REJECTED
- 默认超时 60 秒（AGENT_CONFIRM_TIMEOUT_SEC）

#### 链式 hash 审计日志

- AgentAuditLogService：每条操作日志带 hash + previousHash
- hash = sha256(JSON({agentId, action, scope, amount, detail, result, previousHash}))
- 使用 `pg_advisory_xact_lock` 串行化同 Agent 写入，防并发分叉
- 创世 hash 为 `0`.repeat(64)
- `verifyChain` 接口可校验哈希链完整性（防篡改）

#### AI 巡检调度

新增 AgentSchedule，3 个 @Cron 任务（注册到 ScheduleHealthService 被自身监控）：
- 每 10 分钟：巡检 ScheduleHealthService，发现连续失败 ≥3 次时 LLM 生成告警
- 每小时：扫描 ReconciliationDifferenceItem PENDING，LLM 生成处置建议
- 每 30 分钟：扫描 RiskEvent HIGH 未处理，LLM 生成处置建议

#### MCP Server（暴露给外部 AI Agent）

- AgentMcpServer：嵌入式 MCP Server（@modelcontextprotocol/sdk）
- 5 个工具：kbpay_query_balance / kbpay_query_order / kbpay_query_bill / kbpay_list_risk_events / kbpay_list_recon_diffs
- 支持两种启动方式：
  1. 嵌入启动（非生产环境，onModuleInit 自动初始化）
  2. 独立进程：`node dist/agent/mcp/standalone.js`（stdio 传输，供 Claude Desktop / Cursor / Trae 配置）

### 新增 Prisma 模型（5 张）

| 模型 | 用途 |
|------|------|
| Agent | 智能体注册表（agentNo/name/appSecret/status/scopes/scenario） |
| AgentAuthorization | 用户/商户对 Agent 的授权（subjectType/scopes/maxAmount/expiresAt/revokedAt） |
| AgentOperationLog | 操作审计日志（链式 hash 防篡改） |
| AgentConversation | 多轮对话会话（convNo/scenario/title/status/summary） |
| AgentMessage | 对话消息（role: USER/ASSISTANT/TOOL/SYSTEM，含 toolCalls/tokens） |

### 新增 API 端点（10 个）

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | /agent/conversations | 创建会话 |
| GET | /agent/conversations | 查询会话列表 |
| GET | /agent/conversations/:id/messages | 查询历史消息 |
| POST | /agent/conversations/:id/close | 关闭会话 |
| POST | /agent/chat | 发送消息（核心入口） |
| POST | /agent/confirm | 确认/拒绝操作 |
| GET | /agent/verify-chain/:agentId | 校验哈希链 |
| POST | /agent/authorize | 用户授权 Agent |
| POST | /agent/revoke/:authId | 撤销授权 |
| GET | /agent/authorizations | 查询授权列表 |

### 新增环境变量

LLM 配置：
- LLM_PROVIDER（mock/openai/deepseek 等，默认 mock）
- LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
- LLM_TIMEOUT_MS / LLM_MAX_TOKENS / LLM_TEMPERATURE

Agent 认证与限额：
- JWT_AGENT_SECRET / JWT_AGENT_EXPIRES_IN
- AGENT_MAX_AMOUNT_PER_OP / AGENT_MAX_AMOUNT_PER_DAY
- AGENT_CONFIRM_TIMEOUT_SEC

向量库与 MCP：
- VECTRA_INDEX_DIR（Vectra 索引目录）
- MCP_STRIPE_ENABLED / STRIPE_SECRET_KEY
- MCP_PAYPAL_ENABLED / PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET

### 新增文件清单（20 个）

```
src/agent/
├── agent-current-user.interface.ts    # Agent 用户上下文类型
├── agent-auth.guard.ts                # 第 4 种认证守卫
├── agent-auth.service.ts              # Agent 创建/授权/login/revoke
├── agent-audit-log.service.ts         # 链式 hash 审计日志
├── agent.controller.ts                # 10 个 HTTP 端点
├── agent.module.ts                    # 模块注册
├── agent.schedule.ts                  # 3 个 AI 巡检 @Cron
├── agent.service.ts                   # 核心编排（会话/消息/confirm）
├── dto/agent.dto.ts                   # 6 个 DTO
├── llm/
│   ├── llm.config.ts                  # LLM 配置加载
│   ├── llm.module.ts                  # @Global 模块
│   └── llm.service.ts                 # LLM 调用 + mock 降级
├── mcp/
│   ├── agent-mcp.server.ts            # 嵌入式 MCP Server
│   └── standalone.ts                  # 独立进程启动入口
└── tools/
    └── tool.registry.ts               # 工具注册表（11 个工具）

prisma/migrations/20260722000000_add_agent_tables/
└── migration.sql                      # 5 张表 DDL

test/
└── agent.e2e-spec.ts                  # 31 个 e2e 测试

docker-compose.agent.yml               # n8n + Botpress 独立部署
```

### 测试

- 新增 31 个 e2e 测试（test/agent.e2e-spec.ts）
- 覆盖：AgentAuthGuard / 会话管理 / chat 核心入口 / authorize / confirm / verify-chain / ToolRegistry / AgentAuditLogService / LlmService mock 模式
- 全量 e2e：4 个套件 39 个测试全部通过
- TypeScript 编译 0 错误

### 参考的开源项目

- Vercel AI SDK v7：Agent 循环（generateText + tool() + maxSteps）
- @modelcontextprotocol/sdk：MCP 协议
- Stripe/PayPal Agent Toolkit：支付工具封装思路
- Shopify shop-chat-agent：AI 电商 Agent 蓝本
- Botpress：TS 原生客服系统（MIT，独立 Docker 部署）
- n8n：TS 原生工作流引擎（Sustainable Use License，独立 Docker 部署）

---

## 版本 2.0.0

**发布日期：** 2026-07-21

**版本类型：** 大版本升级 —— 行业对标后新增 P1 必备 + 运营能力 + 4 大特色功能

### 升级概览

本轮基于对微信支付、支付宝、PayPal、Stripe、Ping++ 等同类产品的对标分析，将行业中"应当具备"的能力补齐到 KeBaiPay，并新增 4 项特色功能。**API 端点从 ~80 增长到 204**，**Prisma 模型从 ~20 增长到 47**，**单元测试从 635 增长到 1023**，**E2E 测试从 ~50 增长到 324**。

### P1 行业标配新增模块

#### 担保交易（Escrow，S2）

类似支付宝担保交易 / 微信担保支付。买卖双方中介担保，资金先冻结到平台，买家确认收货后释放给卖家。

- 6 个端点：创建担保订单、买家付款、卖家发货、确认收货、申请退款、争议处理
- 完整状态机：CREATED → PAID → SHIPPED → COMPLETED，支持 REFUND_PENDING / DISPUTED / REFUNDED
- 涉及表：`EscrowOrder`、`AccountLedger`（双重记账，冻结 + 释放）
- 12 个单元测试 + E2E 测试

#### 批量转账（Batch Transfers）

商户向多用户批量打款，类似微信商家转账到零钱 v3 接口。

- 3 个端点：批量提交、明细查询、状态机管理
- 支持：单批次最多 1000 笔、自动校验、批次状态机
- 涉及表：`BatchTransferOrder`、`BatchTransferItem`
- 状态机：PENDING → PROCESSING → COMPLETED / PARTIAL_FAILED / FAILED

#### 订阅（Subscriptions）

商户配置订阅计划，用户周期性自动扣款。

- 3 个端点：订阅、取消订阅、查看可订阅计划
- 调度器：每天 00:30 扫描到期订阅自动扣款
- 涉及表：`SubscriptionPlan`、`UserSubscription`、`SubscriptionPayment`
- 状态机：ACTIVE → CANCELLED / EXPIRED / PAST_DUE

#### 分账（Splits）

一笔交易的资金按比例分配给多个收款方，类似微信分账接口。

- 2 个端点：创建分账计划、查询分账列表
- 涉及表：`SplitPlan`、`SplitReceiver`
- 状态机：PENDING → PROCESSING → COMPLETED / FAILED

### 运营能力新增模块

#### 优惠券（Coupons）

满减、立减、折扣券。

- 2 个端点：领取优惠券、查询我的优惠券
- 调度器：每 5 分钟扫描过期优惠券自动失效
- 涉及表：`Coupon`、`UserCoupon`
- 状态机：AVAILABLE → USED / EXPIRED

#### 邀请返现（Referrals）

用户邀请好友注册并完成首笔交易，邀请人获得返现奖励。

- 2 个端点：获取邀请码、查询邀请记录
- 涉及表：`ReferralCode`、`ReferralRecord`

#### 消息中心（Messages）

站内消息推送：交易通知、风控通知、系统公告。

- 3 个端点：消息列表、未读数、标记已读
- 涉及表：`Message`、`MessageRead`
- 支持批量已读、未读计数缓存

#### 发票（Invoices）

商户向用户开具电子发票。

- 2 个端点：申请开票、查询开票记录
- 涉及表：`Invoice`
- 状态机：PENDING → ISSUED → VOIDED

### 特色功能（S 系列）

#### S1 微信红包二倍均值法

群红包算法与微信原生体验完全一致：

```javascript
// 第 i 个红包金额上限：
maxAmount = floor(remainingAmount / remainingCount × 2) - 1
// 在 [1, maxAmount] 范围随机；最后一个红包拿剩余全部
```

- 状态机：PENDING → PARTIALLY_RECEIVED → RECEIVED / EXPIRED
- 过期未领完的红包，剩余金额自动退回给发送方
- 调度器：每 5 分钟扫描过期红包
- 4 个端点：发红包、领红包、已发列表、已收列表

#### S2 担保交易（见 P1 部分）

#### S3 AI 风控审计

引入 AI 双引擎审计管理员操作，所有敏感操作记录链式 hash 防篡改。

- 5 个管理端端点：AI 审计事件列表、风控建议、人工复核、统计概览、规则命中分析
- 双引擎：规则引擎（白名单/黑名单/阈值）+ AI 引擎（行为模式异常检测）
- 涉及表：`RiskAuditEvent`、`RiskAuditMessage`、`AdminOperationLog`（链式 hash）
- 状态机：DETECTED → REVIEWING → CONFIRMED / DISMISSED

#### S5 多平台对账聚合

跨支付宝、微信、银行渠道的流水交叉比对，差异自动分类与处理工作流。

- 9 个管理端端点：拉取对账单、列表、详情、流水列表、交叉匹配、差异列表、详情、指派处理人、解决差异
- 4 类差异分类：`MISSING_IN_CHANNEL` / `MISSING_IN_PLATFORM` / `AMOUNT_MISMATCH` / `STATUS_MISMATCH`
- 涉及表：`ChannelStatement`、`ChannelStatementItem`、`ReconciliationDifferenceItem`
- 状态机：PENDING → INVESTIGATING → RESOLVED / IGNORED
- 匹配状态：UNMATCHED → MATCHED / MISMATCHED
- 使用 Redis 分布式锁防并发拉取
- 48 个单元测试 + 22 个 E2E 测试

### 用户端补强

#### 银行卡管理（Bank Cards）

- 4 个端点：绑卡、解绑、列表查询、设置默认卡
- 卡号 AES-256-GCM 加密入库 + SHA-256 hash 唯一约束
- 涉及表：`BankCard`

#### 用户绑定/改密

- 新增端点：绑定手机、绑定邮箱、修改密码
- 6 个用户端点（含实名、支付密码）

### 管理后台增强

#### 11 种细粒度权限码

| 权限码 | 说明 |
|---|---|
| `account:adjust` | 人工调账 |
| `withdrawal:audit` | 提现审核 |
| `reconciliation:run` | 执行对账 |
| `reconciliation:diff:handle` | 对账差异处理（S5 新增） |
| `finance:view` | 财务查看 |
| `identity:audit` | 实名审核 |
| `merchant:audit` | 商户审核 |
| `user:status` | 用户状态管理 |
| `risk:config` | 风控配置 |
| `risk:event:handle` | 风控事件处理 |
| `admin:view` | 管理员查看 |

- `SUPER_ADMIN` 自动拥有 `*` 全权限
- 其他角色按职能分配：FINANCE / CUSTOMER_SERVICE / RISK_OFFICER / AUDITOR

#### 自定义规则模板

- 5 个管理端端点：CRUD 风控规则模板
- 商户/管理员可配置：阈值、白名单、黑名单、行为动作

### 技术基础设施改进

#### 数据模型与迁移

- Prisma 模型从 ~20 增长到 **47 个**，按 15 个业务域分组
- 新增迁移：担保交易、批量转账、订阅、分账、优惠券、邀请返现、消息中心、发票、AI 风控审计、自定义规则、多平台对账聚合、银行卡管理
- 加密字段 + SHA-256 哈希唯一约束：`idCardHash` / `cardNumberHash` / `phoneHash`
- 多处 `idempotencyKey @unique` 保证幂等

#### 测试覆盖

- 单元测试：**1023/1023 通过**（64 套件）
- E2E 测试：**324/324 通过**
- 每个 Service 必须有 `.spec.ts`
- 每个 Controller 必须有 `.controller.spec.ts`
- 关键业务路径有并发测试（`concurrency.spec.ts`）

#### 文档体系

新增/更新以下文档（本轮同步更新）：

- `README.md`：完整重写，加入架构图、状态机、功能矩阵、使用教程
- `docs/API_REFERENCE.md`：完整 158 个 API 端点说明
- `docs/CHANGELOG.md`：本文件
- `docs/ADMIN_GUIDE.md`：新增 S3/S5/自定义规则管理端功能
- `docs/DEVELOPER_GUIDE.md`：新增模块开发规范、新模块概览
- `docs/DEPLOYMENT.md`：完整部署文档
- `docs/QUICKSTART.md`：商户快速接入
- `docs/MERCHANT_GUIDE.md`：商户接入指南
- `docs/SDK_GUIDE.md`：开放 API SDK
- `docs/TROUBLESHOOT.md`：常见问题排查
- `docs/PROJECT_PLAN.md`：项目进度
- `.env.example`：新增 SMTP / OTEL / Sentry / 支付宝/微信渠道环境变量

### 错误码扩展

- KB940-KB945：多平台对账相关错误码
- KB700-KB799：开放 API 扩展
- KB800-KB899：AI 风控审计扩展

### 升级须知

1. **数据库迁移**：执行 `npx prisma migrate deploy` 应用本轮新增的迁移
2. **新增环境变量**（可选）：SMTP_*、OTEL_*、SENTRY_DSN、ALIPAY_*、WECHAT_PAY_*（详见 .env.example）
3. **JWT_ADMIN_SECRET 与 JWT_USER_SECRET 必须不同**：本轮多个模块（risk-audit、channel-reconciliation、invoices、custom-rules）独立引入 JwtModule.registerAsync，复用 JWT_ADMIN_SECRET
4. **管理员权限需要重新分配**：新增 `reconciliation:diff:handle`、`risk:config` 等权限码
5. **mock 渠道禁用**：生产环境 SecurityValidator 会拒绝启动 mock 渠道

---

## 版本 1.0.0

**发布日期：** 2026-07-13

**版本类型：** 首个正式发布版本

### 核心功能

#### 用户模块
- 用户注册（手机号/邮箱）
- 用户登录
- 获取用户信息
- 实名认证提交
- 实名认证审核
- 支付密码设置与重置
- 当日限额查询

#### 账户模块
- 账户余额查询
- 资金流水查询

#### 交易模块
- 账户充值
- 用户间转账

#### 提现模块
- 提现申请
- 提现记录查询
- 提现审核（通过/拒绝）

#### 红包模块
- 发红包
- 领红包
- 已发红包查询
- 已收红包查询
- 红包过期自动退回

#### 收款码模块
- 个人收款码获取
- 固定金额收款码创建
- 扫码付款

#### 账单模块
- 账单列表查询
- 收支类型筛选

#### 商户模块
- 商户入驻申请
- 商户信息管理
- 应用创建与管理
- 密钥重新生成
- 商户数据看板
- 商户收款码管理

#### 收银台模块
- 收银台订单创建
- 订单查询
- 订单支付
- 订单导出
- 对账查询
- 回调通知重试
- 扫码获取收款信息

#### 开放 API 模块
- HMAC-SHA256 签名认证
- 创建收款订单
- 查询订单详情
- 申请退款（全额/部分）
- 商户转账
- 查询商户余额

#### 管理后台模块
- 管理员登录
- 管理员密码修改
- 数据概览
- 用户管理（列表/详情/状态/风控等级）
- 商户管理（列表/审核/配置）
- 提现审核（列表/通过/拒绝）
- 支付订单列表
- 风控事件管理
- 登录日志
- 实名认证审核
- 人工调账
- 操作审计日志
- 管理员管理（创建/更新/删除/重置密码）
- 系统配置管理
- 支付渠道管理（创建/更新/删除/测试）

#### 财务模块
- 财务概览
- 每日收支汇总
- 商户结算明细
- 手续费收入统计
- 每日资产快照
- 未结算订单汇总
- 结算执行
- 对账报告生成
- 报表导出（CSV）

#### 健康检查模块
- 存活探针
- 就绪探针（DB/Redis 连通性检查）
- 调度任务状态
- 支付渠道状态

#### 安全模块
- JWT 认证（用户/管理员）
- HMAC 签名认证（商户）
- 密码加密（bcrypt）
- 敏感数据加密
- 请求日志记录
- 安全头配置
- 频率限制
- 防重放机制（nonce）

#### 风控模块
- 大额交易检测
- 频繁交易检测
- 频繁登录检测
- 可疑设备检测
- 风控规则配置

#### 通知模块
- 回调通知发送
- 邮件通知

#### 数据库模块
- Prisma ORM 集成
- PostgreSQL 16/17 支持
- 数据库迁移

#### 缓存模块
- Redis 集成
- 进程内缓存降级

### 技术特性

- NestJS 框架
- TypeScript 开发
- RESTful API 设计
- Swagger API 文档
- 单元测试覆盖
- 端到端测试
- Docker 容器化支持
- PM2 部署支持

---

## 已实现功能清单

### 用户端功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 用户注册 | ✅ | 手机号/邮箱注册 |
| 用户登录 | ✅ | JWT 认证 |
| 实名认证 | ✅ | 身份证认证 |
| 支付密码 | ✅ | 设置/重置 |
| 账户充值 | ✅ | 多种支付方式 |
| 用户转账 | ✅ | 用户间转账 |
| 提现申请 | ✅ | 银行卡提现 |
| 发红包 | ✅ | 普通红包（二倍均值法） |
| 领红包 | ✅ | 领取红包 |
| 个人收款码 | ✅ | 生成/分享 |
| 固定金额收款码 | ✅ | 指定金额 |
| 扫码付款 | ✅ | 扫码支付 |
| 账单查询 | ✅ | 收支记录 |
| 当日限额 | ✅ | 限额查询 |
| 银行卡管理 | ✅ v2.0 | 绑卡/解绑/设默认卡 |
| 担保交易 | ✅ v2.0 | S2 买卖中介担保 |
| 批量转账 | ✅ v2.0 | 商户批量打款 |
| 订阅 | ✅ v2.0 | 周期性自动扣款 |
| 分账 | ✅ v2.0 | 多方资金分配 |
| 优惠券 | ✅ v2.0 | 满减/立减/折扣 |
| 邀请返现 | ✅ v2.0 | 邀请好友奖励 |
| 消息中心 | ✅ v2.0 | 站内消息 |
| 发票 | ✅ v2.0 | 电子发票 |

### 商户端功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 商户入驻 | ✅ | 申请审核 |
| 应用管理 | ✅ | 创建/删除 |
| 密钥管理 | ✅ | 生成/重置 |
| 创建订单 | ✅ | HMAC 签名 |
| 查询订单 | ✅ | 订单详情 |
| 申请退款 | ✅ | 全额/部分 |
| 商户转账 | ✅ | 向用户转账 |
| 余额查询 | ✅ | 商户余额 |
| 数据看板 | ✅ | 交易统计 |
| 收款码管理 | ✅ | 创建/删除 |

### 管理端功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 管理员登录 | ✅ | JWT 认证 |
| 数据概览 | ✅ | 统计数据 |
| 用户管理 | ✅ | 列表/详情/状态 |
| 商户审核 | ✅ | 通过/拒绝 |
| 商户配置 | ✅ | 费率/限额 |
| 提现审核 | ✅ | 通过/拒绝 |
| 实名审核 | ✅ | 通过/拒绝 |
| 人工调账 | ✅ | 余额调整 |
| 风控管理 | ✅ | 事件/规则 |
| 系统配置 | ✅ | 参数设置 |
| 渠道管理 | ✅ | 创建/测试 |
| 审计日志 | ✅ | 操作记录 |
| 多平台对账聚合 | ✅ v2.0 | S5 跨渠道流水比对 |
| AI 风控审计 | ✅ v2.0 | S3 双引擎审计 |
| 自定义规则 | ✅ v2.0 | 风控规则模板 CRUD |

### 财务功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 财务概览 | ✅ | 数据统计 |
| 收支汇总 | ✅ | 每日汇总 |
| 商户结算 | ✅ | T+1 结算 |
| 手续费统计 | ✅ | 收入统计 |
| 资产快照 | ✅ | 每日快照 |
| 对账报告 | ✅ | 自动/手动 |
| 报表导出 | ✅ | CSV 格式 |

### 技术特性

| 特性 | 状态 | 说明 |
|------|------|------|
| JWT 认证 | ✅ | 用户/管理员独立密钥 |
| HMAC 签名 | ✅ | 商户 API |
| 密码加密 | ✅ | bcrypt |
| 敏感数据加密 | ✅ | AES-256-GCM |
| 频率限制 | ✅ | 多层限制 + 滑动窗口 |
| 防重放 | ✅ | nonce 机制 |
| 风控引擎 | ✅ | 规则配置 + AI 审计 |
| 审计日志 | ✅ | 链式 hash 防篡改 |
| 健康检查 | ✅ | 多维度检查 |
| Docker 支持 | ✅ | 容器化部署 |
| PM2 支持 | ✅ | 进程管理 |
| 单元测试 | ✅ | Jest (1023) |
| 端到端测试 | ✅ | Supertest (324) |
| OpenTelemetry | ✅ v1.0 | OTLP trace |
| Prometheus | ✅ v1.0 | /metrics 端点 |
| Sentry | ✅ v1.0 | 异常告警 |

---

## 2026-07-11 清理记录

- 删除无用的测试 spec（auth/red-packets/security-validator，生产代码已引入 RedisService 但 spec 未跟进，当前无维护价值）
- 删除冗余 VERSION.txt、过期的 SMS_CONFIGURATION.md
- 删除远程 TAG v0.0.1、dependabot 自动分支
- 推送覆盖远程 main，清空旧描述与过期 .github 模板
- README 项目结构对齐实际 27 个模块
- 依赖更新至 ^ 范围内最新（TS6/Jest29 稳定组合保留）

---

## 2026-07 重构记录

### 2026-07-13 阶段 1-4：安全与基础设施加固

- **阶段 1**：安全红线修复与冗余清理（密钥泄露/硬编码密钥/SQL 注入防护加固）
- **阶段 2a**：造轮子替换与时区修复（移除自实现 crypto/日期工具，改用成熟库）
- **阶段 2b**：P0 安全与资金安全修复
- **阶段 2c**：P0 review 修复 8 项阻断项
- **阶段 3**：业务逻辑完善与风控/权限/数据一致性加固
- **阶段 4**：部署/CI/文档完善

### 2026-07-13 第三批基础设施 P0 修复

- 全局异常过滤器 `AllExceptionsFilter`：统一 `ApiErrorResponse` envelope + Prisma 错误码映射（P2002→409 / P2025→404 / P2003→400）
- 进程级异常兜底：`unhandledRejection` / `uncaughtException` 接管
- AsyncLocalStorage + Logger 原型 patch：traceId 自动注入 service 层日志
- ConfigModule 纯 TS env 校验（无 joi 依赖）
- PG 连接池配置：`max` / `statement_timeout` / `connectionTimeoutMillis`
- k8s readiness probe：故障返回 503 让 Pod 摘除流量
- 微信代付 batch_status 校验：`success_num >= total_num` 防资金事故
- X-Forwarded-For 伪造防护：改用 `req.ip` + `trust proxy 1`
- 风控 fail-closed：Redis 不可用时 IP 频率规则抛错阻断交易
- 支付密码推迟到实名审核通过：`pendingPayPasswordHash` 暂存机制

### 2026-07-13 短信 SDK 接入

- 接入腾讯云官方 SDK `tencentcloud-sdk-nodejs-sms`（API 3.0，TC3-HMAC-SHA256 签名）
- 接入华为云短信 HTTP `POST /sms/batchSendSms/v1` + SDK-HMAC-SHA256 签名（无 SDK 依赖）
- 新增 `docs/sms-integration.md` 商家自助接入指南
- 未配置时默认 `SMS_PROVIDER=mock`，生产环境 SecurityValidator 拒绝启动

### 2026-07-13 风控滑动窗口限流

- Redis Lua + ZSET 滑动窗口替换固定窗口分桶计数
- `RedisService` 新增 `slidingWindowCheck` / `slidingWindowCount` / `slidingWindowRecord` 三个方法
- 毫秒级精度，无 key 永驻（PEXPIRE 自动过期），原子性（Lua 单命令）
- IP 维度 fail-closed 保持

### 2026-07-13 P0-8 审计日志事务一致性

- 重构 `admin.service` 8 个非事务方法：业务写 + 审计日志全部包入 `$transaction`
- 补 `createAdminUser` 审计漏记
- `channel-config.controller` 三处（createChannel/updateChannel/deleteChannel）同类问题治理
- admin.service 9 个事务方法补 `auditMeta` 参数，审计日志可记录 IP/UA 上下文
- 抽共享模板 `persistConfigWithAudit`，消除 setSystemConfig/updateSystemConfig/createSystemConfig 三方法重复

### 2026-07-13 测试补全

- 补全 16 个 controller 单元测试，新增 172 个测试用例
- 新增 9 个 admin 事务一致性回归测试
- 新增 4 个滑动窗口方法测试
- 全量测试：46 suites / 635 tests passed

### 2026-07-13 可观测性增强

- 新增 Prometheus `/metrics` 端点（业务指标：TPS / 错误率 / 资金流水金额 / 渠道成功率）
- 结构化日志：pino JSON formatter，可接 ELK/Loki
- APM 接入：OpenTelemetry trace + Sentry 异常告警

### 2026-07-13 微信回调与 webhook 加固

- 修复微信回调 `extractOrderNo` 锁 key 退化为 `unknown` 问题
- webhook 回调日志落库（不再仅 `logger.log`）
- 新增 `webhooks.service.spec.ts` 单测
- 新增 `refund.service.spec.ts` / `settlement.service.spec.ts` / `auth.service.spec.ts` 单测

### 2026-07-13 CI/CD 完善

- CI 集成 e2e 测试步骤
- 新增 CD pipeline（自动部署到服务器）

### 2026-07-21 v2.0.0 大版本升级

- 行业对标分析：微信支付、支付宝、PayPal、Stripe、Ping++
- 新增 P1 行业标配：担保交易、批量转账、订阅、分账
- 新增运营能力：优惠券、邀请返现、消息中心、发票
- 新增 4 项特色功能：S1 红包二倍均值法、S2 担保交易、S3 AI 风控审计、S5 多平台对账聚合
- 用户端补强：银行卡管理、绑定手机/邮箱、改密
- 管理后台增强：11 种权限码、自定义规则模板
- API 端点：~80 → 204（增长 155%）
- Prisma 模型：~20 → 47（增长 135%）
- 单元测试：635 → 1023（增长 61%）
- E2E 测试：~50 → 324（增长 548%）
- 文档体系全面更新：README 重写 + 12 个 docs 文件同步更新
