# KeBaiPay 技术债盘点与重构排期

> 技术债治理师（tech-debt-strategist）· 团队 kebaipay-audit
> 代码基线：main @ d01d80c（2026-09-22），NestJS 12.0.4 / Prisma 7.10.0 / TypeScript 6.0.3 / Jest 30.5.1 + ts-jest 29.4.12
> 产出：债务台账（量化 + 优先级）→ 还债配额与节奏 → 小步重构路径 → 对交付的权衡

---

## 0. 结论速览（TL;DR）

- **债务总量**：识别 **14 项**实质技术债，其中 **4 项 P0（本周必还）**、**6 项 P1（两周内）**、**4 项 P2（排期还）**。
- **最高风险不在「新功能」，而在「迁移收尾」**：NestJS 11→12 迁移**功能上已完成**，但**文档、注释、依赖类型**残留未清理，属于「已经付过钱但没记账」的状态——低成本、高收益，应最先清偿。
- **测试基线是最大不确定性**：Jest ESM 加载问题（任务 #7）当前靠 `transformIgnorePatterns: ['node_modules/(?!@nestjs)']` + `@nestjs/axios` CJS mock 双保险压制；**没有跑通全量测试前，任何重构都不应合入**，这是还债的前置门禁。
- **12 个 dependabot 分支本地已全部并入 main**（`main..branch` 均为 0 commit），远程 11 个分支是**合并后未清理的残留**——纯运维清理项，P1 一次 PR 清完即可。
- **还债配额建议**：新功能交付节奏不压垮的前提下，**每 10 个新功能任务配 1 个还债任务**（~10% 配额），P0 项本周内清零。

---

## 1. 债务台账

> 基线：14 项 D1–D14。已合并 code-quality-reviewer 同步的 CQ-m3 / CQ-m4，
> 新增 **D15 / D16 / D17**（CQ-M1 `toUserId` 不安全断言属资金路径高危缺陷，
> 与「重构排期」性质不同，单列跟踪，不占还债配额）。

### 1.1 原始台账（D1–D14）

| # | 债务 | 位置 | 类型 | 成本/风险（量化） | 优先级 |
|---|------|------|------|-------------------|--------|
| D1 | **Jest ESM 加载失败（NestJS12）未验证全量通过**：`@nestjs/*` 运行时包 ESM-only，CJS Jest 需 `transformIgnorePatterns` 放行 + `@nestjs/axios` CJS mock 双保险；85 个 spec + e2e 未确认全绿 | `jest.config.js`、`test/jest-e2e.config.js`、`test/mocks/nestjs-axios.mock.ts` | 测试基础设施 | **高风险 / 中高成本**：未跑通前无法信任任何重构结果；mock 只覆盖 `get/post`，未来 connector 若用 `patch/put/delete/拦截器` 会假通过 | **P0** |
| D2 | **`jest.config.js.bak-nestjs11` + `test/jest-e2e.config.js.bak-nestjs11` 迁移残留文件**：旧 NestJS 11 配置快照未删除 | 根目录 + `test/` | 遗留/混淆 | **低 / 低成本**：误导后续维护者以为还有双套配置；版本控制噪音 | **P0** |
| D3 | **文档与代码版本漂移：仍写 NestJS 11**（`docs/`、3 个 README、`package.json` description）10 处 | `docs/DEPLOYMENT.md`、`docs/DEVELOPER_GUIDE.md`、`docs/SECURITY_AUDIT.md`、`README.md/.en/.ja`、`package.json` | 文档债 | **中风险 / 低成本**：对外宣称 NestJS 11 实际跑 12，误导部署与二次开发；`SECURITY_AUDIT.md` 还把「NestJS 11→12 版本差」列为未清偿 P2 | **P0** |
| D4 | **`@types/nodemailer@8.0.2` 与 `nodemailer@10.0.10` 跨 2 个 major 的 API 漂移** | `package.json` devDependencies | 依赖债 | **中风险 / 低成本**：类型 8 不覆盖 10 的新 API/重命名，TypeScript 可能假绿；SMTP 相关（金融场景邮件通知）一旦运行时签名变化会静默失败 | **P1** |
| D5 | **11 个 dependabot 远程分支合并后未清理**（含 3 个 web 前端组 + nestjs + nodemailer + 3 github_actions + minor-and-patch + ai-and-mcp + nanoid） | `origin/dependabot/*`（11 个） | 运维/分支债 | **低风险 / 低成本**：`main..branch` 全为 0，纯残留；占用 PR 通知与 CI 资源，且 `actions/checkout-7`、`setup-node-7` 等仍可能被 CI 误触发 | **P1** |
| D6 | **Prisma 7 driver adapter 已落地但**「连接池参数 `DATABASE_CONNECTION_LIMIT` 等 3 个 env」**无 `.env.example` 兜底与 CI 注入校验** | `src/prisma/prisma.service.ts`、`prisma.config.js` | 设计债 | **中风险 / 低成本**：`prisma.config.js` 用 `env('DATABASE_URL')` 强制存在，但 `DATABASE_CONNECTION_LIMIT/STATEMENT_TIMEOUT_MS/POOL_TIMEOUT_SEC` 走默认值，**多副本部署时 3 个副本 × 5 连接 = 15**，未与 PG `max_connections` 联动，是隐性容量债 | **P1** |
| D7 | **146 处 `as any`（集中在 spec）+ 2 处 `@ts-ignore`**：type-escape 掩盖真实类型错误 | `src/**.spec.ts`（channel-config 17、splits 12、merchants 11、coupons 11、admin 11…）；`src/agent/mcp/agent-mcp.server.ts` 5 处 | 坏味道 | **中风险 / 中成本**：spec 里 `as any` 让 mock 失守；`agent-mcp.server.ts` 在生产代码 5 处 `as any`，MCP 协议字段一旦上游 schema 变化会静默错 | **P1** |
| D8 | **`ts-jest@29` + `jest@30` 边界版本兼容**（peer `^29.0.0 \|\| ^30.0.0`）：ts-jest 30 已发布，仍压 29 | `package.json` devDependencies | 依赖债 | **低风险 / 低成本**：peer 兼容但非官方推荐，未来 jest 31 会失配；一次性升级成本低 | **P2** |
| D9 | **3 前端 monorepo 共享依赖版本漂移风险**（web/web-admin/web-h5 各自独立 `package-lock.json`，vue/element-plus/pinia 目前一致，但无 workspace 收敛） | `web/`、`web-admin/`、`web-h5/` | 架构债 | **中风险 / 中成本**：当前靠 `scripts/version-sync.mjs` 校验 4 个 lockfile，但**依赖版本不收敛**，element-plus 升 2.15 时 3 处各升一次，且 `vue-router@5.3.1` 与 `vue@3.5.42` 的官方推荐搭配未锁定 | **P2** |
| D10 | **`src/users/users.service.ts:502` 邮箱验证码走短信**（单 TODO 注释，未实现 email 通道） | `src/users/users.service.ts` | 功能债 | **中风险 / 中成本**：金融场景，邮箱验证码缺失是合规缺口；「暂通过短信发到用户已绑定的手机号」在用户手机号泄露场景无法二次验证 | **P1** |
| D11 | **`overrides` 块里 4 项覆盖**（uuid 11 / deepmerge-ts 8 / mysql2 3.24 / multer 2.3）+ `mailparser.nodemailer` 嵌套 override，**无审计依据注释** | `package.json` overrides | 依赖债 | **中风险 / 低成本**：金融场景 multer（文件上传）被锁到 2.3，uuid 锁 11（v4/v7 差异大），**没有注释说明为何不用 10 或 12**，是「谁加的不知道」的隐性决策债 | **P2** |
| D12 | **`docs/SECURITY_AUDIT.md` 把「NestJS 11→12 major 差」列为未清偿 P2**：实际已升 12，文档滞后 | `docs/SECURITY_AUDIT.md:17` | 文档债 | **低风险 / 低成本**：与 D3 同源；安全审计矩阵里的「版本差」行是过期信息，会被后续 audit 误判 | **P0** |
| D13 | **`ts-jest` 转换规则把 `@nestjs/*` 全放行**（`node_modules/(?!@nestjs)`）：未来 Nest 出 12.1 若仍 ESM-only 没问题，但若 Nest 13 转回双发布，**这条规则会让 CJS main 被误转** | `jest.config.js`、`test/jest-e2e.config.js` | 设计债 | **低风险 / 低成本**：当前正确，但缺注释说明「为什么放行整个 @nestjs 而非精确到 @nestjs/axios」 | **P2** |
| D14 | **本地 main 领先 origin/main 23 个 commit 未推送** | `git` | 运维债 | **中风险 / 低成本**：23 个 commit 含 12 个 dependabot merge + 11 个 feat/fix/security，**本地未推送即丢失风险**；团队其他成员看不到这些改动 | **P0** |

### 1.2 新增（CQ 同步，与还债排期重叠项）

| # | 债务 | 位置 | 类型 | 成本/风险（量化） | 优先级 |
|---|------|------|------|-------------------|--------|
| D15 | **`admin.service.ts` 单文件 1433 行跨 5 类职责**（用户管理 / 提现审核 / 实名 / 调账 / 渠道配置），对比同域：`batch-transfers` 902、`escrow` 799、`channel-reconciliation` 654——admin 已是第二大 service 的 1.6 倍 | `src/admin/admin.service.ts` | 坏味道 / 可维护性 | **中风险 / 中成本（~2 人日）**：跨职责改动互相耦合（一次调账改动牵动用户/渠道/审计注入），review 粒度被迫整文件 diff；金融后台是高频改动区，长期放大回归面 | **P1** |
| D16 | **仓库无 ESLint，lint 仅 `tsc --noEmit`**（无 `.eslintrc` / `eslint.config`），坏味道/风格无门禁 | `package.json`（scripts.lint = `tsc --noEmit`） | 基础设施债 | **中风险 / 中成本（~1 人日）**：strict 编译挡不住 `!` 断言、`as any` 滥用、可变共享等；CI 只有编译层单网，同类缺陷只能靠人工 review 兜底 | **P1** |
| D17 | **资金核心域缺最小 lint 门禁**：`transactions/finance/withdrawals/batch-transfers/escrow/splits` 需优先启用 `@typescript-eslint/no-non-null-assertion` + `no-explicit-any`，把 CQ-M1 类不安全 `!` 固化为 CI 阻断项 | `eslint.config`（新增，作用域限 6 个资金域目录） | 设计债（门禁） | **低风险（引入成本）/ 高风险（不引入的回归）**：6 域内现存 `as any` 集中在 `payment-channels/refund` 与 agent 模块（非资金主路径，CQ-m2 已判可保留注释），`!` 冗余断言 ~10 处（CQ-m1），预计一次修复 < 1 人日即可绿 | **P1**（依赖 D16） |

> **CQ-M1 跟踪项（不占配额，单列）**：`transactions.service.ts` L292–L349 `applyRechargeSuccess`
> 对 `toUserId: string | null` 做 `!` 断言且入口缺对称守卫——属 Major 级资金路径缺陷，
> 修复量 ~5 行 + 1 个边界单测，建议 **随 D17 的 PR 一并落地**（门禁上线前必须先让存量绿），
> 由 code-quality-reviewer 实施、qa-engineer 补「`toUserId=null` 订单 → SKIPPED+告警」用例。

---

## 2. 还债计划（配额 + 节奏 + 小步重构路径）

### 2.1 配额原则

- **还债配额 = 新功能投入的 10%**（即每 10 个 feature 任务配 1 个债务任务）。
- **P0 不占配额**：P0 是「已经欠了但没记账」的收尾项，本周内清零，不挤新功能。
- **P1 占配额 60%**，**P2 占配额 40%**。
- **硬门禁**：D1（测试全绿）未完成前，**D2–D14 任何一项都不允许合入主干**——测试基线是还债的安全网。

### 2.2 P0 清零（本周内，1 个 PR 内完成，~0.5 人日）

**PR #1 「迁移收尾：文档 + 残留 + 推送」**（4 项 D2/D3/D12/D14 一次合入）：

1. 删 `jest.config.js.bak-nestjs11`、`test/jest-e2e.config.js.bak-nestjs11`（D2）。
2. `s/ NESTJS 11/NestJS 12/g` 于 `docs/*.md`、`README*.md`、`package.json` description（D3、D12），并更新 `docs/SECURITY_AUDIT.md` 中「NestJS 11→12 版本差」行 → 标记「已清偿（见 56a9846）」。
3. `git push origin main`（D14，23 commit 推送）。
4. 跑 `npm run version:check` 确认 4 个 lockfile 版本同步。

**验收**：`git log origin/main..main` 为 0；`grep -r "NestJS 11" docs` 为 0；`find . -name "*.bak-nestjs11"` 为 0。

### 2.3 P1 排期（两周内，~3 个 PR）

**PR #2 「测试基线全绿 + jest ESM 加固」（D1）**：
- 跑 `npm test` + `npm run test:e2e`，全量记录失败清单。
- 扩展 `test/mocks/nestjs-axios.mock.ts`：补齐 `patch/put/delete/interceptors` 方法，每个返回 `Promise.resolve({ data: {}, status: 200 })`，并加 `jest.fn()` 计数断言，避免假通过。
- 把 `@nestjs/axios` 的 mock 路径收敛成单一 `test/mocks/` 目录下的 `index.ts`，`moduleNameMapper` 指向 `index`，未来加 connector 只改一处。
- 在 `jest.config.js` 头部加 1 行注释：「@nestjs/* ESM-only（Nest 12）→ 整 @nestjs 放行；升级 Nest 13 时重新审计此规则」（顺带清 D13）。

**PR #3 「依赖债一次还」（D4 + D5 + D10）**：
- 升级 `@types/nodemailer` 至匹配 nodemailer 10 的最新版（先 `npm i -D @types/nodemailer@latest`，跑 `npm run lint` 确认无新增类型错误）。
- 批量清理 11 个 `origin/dependabot/*` 远程分支（`git push origin --delete` × 11），同时确认 12 个 dependabot PR 已关闭/合并。
- 在 `src/users/users.service.ts:502` 处加 `@todo` 标记 + 建 issue 跟踪「邮箱验证码独立通道」，避免被「暂走短信」的现状掩盖。

**PR #4 「类型债 + 连接池参数 + 最小 lint 门禁」（D6 + D7 + D17 + CQ-M1）**：
- `.env.example` 补 `DATABASE_CONNECTION_LIMIT/STATEMENT_TIMEOUT_MS/POOL_TIMEOUT_SEC` 三行默认值 + 注释「多副本部署按 `PG max_connections / 副本数` 调整」。
- 把 spec 里最高频的 4 个文件（channel-config/splits/merchants/coupons，共 51 处 `as any`）的 `as any` 收敛为**接口断言 + 局部窄化**；`agent-mcp.server.ts` 5 处 `as any` 改为 `satisfies` 或显式 DTO。目标：`as any` 总数降到 < 60。
- 引入 NestJS 官方 ESLint 基线（`eslint-config-prettier` 收尾，保持现有 `format` 脚本不变）；**作用域分两步**：
  1. 资金 6 域（`transactions/finance/withdrawals/batch-transfers/escrow/splits`）先上 `@typescript-eslint/no-non-null-assertion: error` + `no-explicit-any: error`；
  2. 全仓 `no-explicit-any` 默认 warn，避免 146 处存量一次性炸 CI。
- 门禁上线前，先清掉 6 域内存量（CQ-M1 `toUserId!` × 5、CQ-m1 冗余 `!` × ~5、refund 枚举 `as any` 抽常量），保证 CI 首跑即绿。

**PR #4.5 「admin.service 拆分」（D15，紧随 PR #4，~2 人日，绞杀者小步路径）**：
- 目标 5 个子 service，按职责边界切，每步单独 PR、保行为不变：
  1. `AdminUserAdminService`：用户封禁/解封、商户审核（dashboard 统计暂留主 service）；
  2. `AdminWithdrawalService`：提现审批/打款/失败处理（注入 `withdrawals` 域公共方法，避免复制逻辑）；
  3. `AdminRealNameService`：实名审核 + 调账（Ledger 分录写入走 `finance/journal` 既有原子方法，禁止直接拼账本）；
  4. `AdminChannelConfigService`：渠道配置读写（与 `admin-user`/`system-config` controller 解耦）；
  5. 残壳 `AdminService` 只留 dashboard + 委托转发，控制器 `admin.controller.ts`（435 行）按 5 个子 controller 同步瘦身。
- 每步验收：`admin.service.spec.ts`（现有 11 处 `as any` 随拆同步收敛）+ 对应 controller spec 全绿；
  单 PR 控制在 300 行 diff 内，失败 `git revert` 单 PR 回退。

### 2.4 P2 排期（月度，~2 个 PR）

**PR #5 「ts-jest 30 + 双发布规则审计」（D8 + D11）**：
- `npm i -D ts-jest@^30`，跑全量测试确认 30 仍过。
- `package.json` overrides 块每项加 1 行注释「为何锁此版本 / 替代方案是什么」，无注释的视为债务继续挂账。

**PR #6 「前端 monorepo 收敛」（D9）**：
- 引入 pnpm workspace（或 npm workspaces）把 `web/web-admin/web-h5` 收敛到单一 lockfile + 单一 `vue` / `element-plus` / `pinia` 版本源；`scripts/version-sync.mjs` 保留作为「4 lockfile 校验」的过渡，workspace 化后可退役。
- 锁定 `vue-router` 与 `vue` 的官方推荐搭配（在 `web/*/package.json` 加 `resolutions`/`overrides` 注释说明为何选 5.3.1）。

---

## 3. 小步重构路径（每步保行为不变、可回退）

```
阶段 0（前置门禁，本周）
  └─ D1 测试全绿（npm test + test:e2e 全通过）
       ↓
阶段 1（收尾，1 PR / ~0.5d）
  ├─ D2 删 .bak-nestjs11
  ├─ D3/D12 文档 NestJS 11→12
  └─ D14 推送 23 commit 到 origin/main
       ↓
阶段 2（基础设施加固，1 PR / ~1d）
  ├─ D1 扩展 @nestjs/axios mock（patch/put/delete/interceptors）
  └─ D13 jest.config.js 加「整 @nestjs 放行」注释
       ↓
阶段 3（依赖债，1 PR / ~1d）
  ├─ D4 @types/nodemailer 升匹配版
  ├─ D5 清 11 个远程 dependabot 分支
  └─ D10 users.service 邮箱验证码 @todo + issue
       ↓
阶段 4（类型 + 容量 + 门禁，2 PR / ~2.5d）
  ├─ D6 .env.example 补 3 个连接池 env
  ├─ D7 spec 51 处 as any 收敛 + agent-mcp 5 处 as any 改 satisfies
  ├─ D17 NestJS ESLint 基线 + 资金 6 域 no-non-null-assertion/no-explicit-any 门禁
  ├─ CQ-M1 toUserId 守卫 + applyRechargeSuccess 签名收紧（门禁首跑前存量清零）
  └─ PR #4.5 D15 admin.service 拆 5 个子 service（绞杀者小步，每步独立 PR）
       ↓
阶段 5（月度，2 PR）
  ├─ D8 ts-jest 30
  ├─ D11 overrides 注释化
  └─ D9 前端 pnpm workspace 收敛
```

每阶段结束**必须**：`npm run lint && npm test && npm run test:e2e` 三件套全绿才合入；任何阶段失败可 `git revert` 单 PR 回退。

---

## 4. 对交付的权衡（还债 vs 新功能）

| 维度 | 还债配额 10% 的影响 | 说明 |
|------|--------------------|------|
| **功能迭代速度** | 短期 -7%（P0/P1 共 ~8 人日，含 admin 拆分 2 人日 + lint 门禁 1 人日） | 2~3 周内清完 P0/P1 后恢复全速；P2 月度化不影响 sprint |
| **风险暴露面** | 显著下降 | D1 测试基线未验证 = 所有重构的「安全网」缺失；D14 未推送 = 单点丢失风险 |
| **金融合规** | D10 邮箱验证码缺口是**唯一**与合规强相关的债务 | 建议从 P1 提升到 P0 并行推进（与 D1 同时做，~+0.5 人日） |
| **CI/CD** | D5 清 11 个远程分支后，dependabot 自动开 PR 频率下降 ~40% | 与 ci-cd-engineer 协同：dependabot 配置改为「grouped updates + weekly」可进一步降噪 |
| **多前端维护** | D9 workspace 化后，单次升级 3 处变 1 处 | 长期年化节省 ~2 人日/次升级 × 4 次/年 ≈ 8 人日/年 |
| **资金域回归防护** | D17 门禁上线后，CQ-M1 类「不安全 `!`」从 review 兜底变为 CI 阻断 | 门禁与 D1 测试基线互补：测试验行为、lint 验写法；admin 拆分（D15）在门禁下做，每步 300 行 diff 可机审 |

**一句话权衡**：P0 的 4 项都是「已经付过钱但没记账」的收尾债，本周清零**不挤新功能**；P1/P2 按 10% 配额推进，**最坏情况下 sprint 内功能交付仅延迟 1 个任务**，换来测试基线可信 + 类型债减半 + 分支噪音清零。

---

## 5. 交接清单（给 team-lead / ci-cd / security / qa）

- **qa-engineer**：D1 是还债门禁，请协助跑通 `npm test` + `npm run test:e2e` 全量基线并记录失败清单。
- **ci-cd-engineer**：D5 清 11 个远程分支 + dependabot 配置改为 grouped/weekly；D6 的 3 个连接池 env 需注入到 CI / docker-compose。
- **security-engineer**：D10（邮箱验证码走短信）是金融合规缺口，建议提升为 P0 并行；D11 overrides 的 multer 2.3 锁版本需复审文件上传安全边界。
- **code-quality-reviewer**：D7 的 146 处 `as any` 收敛建议按 4 个高频文件（51 处）先做样板，再推广；**已同步 D15（admin.service 拆分 4~6 子 service）与 D16（NestJS 官方 ESLint 基线 + 资金 6 域 `no-non-null-assertion`/`no-explicit-any` 门禁）入台账，请配合 CQ-M1 存量清零与 PR #4.5 拆分样板，你已确认可支援。**
- **performance-engineer**：D6 连接池参数（`connectionLimit=5` × 多副本）是容量债，与你的性能剖析任务 #10/#12 联动，建议把「多副本部署时连接数爆炸」列为性能风险项。
