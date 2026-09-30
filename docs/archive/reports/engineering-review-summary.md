# KeBaiPay 工程评测 + 改造/重构建议报告

- 评测对象：KeBaiPay v0.3.2（NestJS 12 全 ESM + Prisma 7 + PostgreSQL + Redis + Stripe/支付宝/微信支付）
- 评测方式：全栈开发战队 `kebaipay-audit` 团队 5 位成员专业评审 + 主理人汇编
- 评测基线：单测 85/85 套件 / 1293 测试、e2e 5/5 套件 / 49 测试、`tsc --noEmit` 0 错（已 disk-verify）
- 远端锚点：GitHub `x33834/KeBaiPay` @ `b52ab33`
- 日期：2026-09-22

> 本报告汇编 5 份专业成员报告（见 §7 索引），主理人只做编排与汇编，专业结论以成员产出为准。

---

## 0. 一句话结论

**KeBaiPay 是一个工程化成熟度较高的金融支付系统**：资金链路（验签/幂等/对账/复式记账/密钥）高度硬化，`npm audit` 0 已知 CVE，单测/e2e 全绿。本轮评测的**核心交付是 Jest ESM 全链路修复（已合入并推送）**，把「测试基线不可信」这一最大不确定性（tech-debt 台账 D1/P0）清零。剩余改造建议集中在**资金写放大的性能优化**、**代码质量门禁（ESLint）补建**、**admin God Object 拆分**三大块，均为零正确性风险的渐进式改进。

---

## 1. 全绿三关（已 disk-verify，本轮核心交付）

| 关卡 | 命令 | 结果 |
|------|------|------|
| 单测 | `npm test` | `Test Suites: 85 passed / Tests: 1293 passed` |
| e2e | `npm run test:e2e` | `Test Suites: 5 passed / Tests: 49 passed` |
| 类型 | `npx tsc --noEmit` | 0 错误（exit 0） |

**Jest ESM 全链路修复**（NestJS 12 全 ESM + Node v22 不支持原生 `require(esm)`，故 Jest 切 ESM 模式，本轮 5 类根因分治修复）：

| 根因 | 现象 | 修法 | 文件 |
|------|------|------|------|
| ESM 传递依赖 | 32 套件 "Must use import to load ES Module"（libphonenumber-js） | `esm-resolver.cjs` 劫持入口与内部 `metadata.*.json` → 真 CJS/JSON | `test/esm-resolver.cjs` |
| DI 反射丢失 | 22 套件 "Nest can't resolve dependencies of JwtAuthGuard" | `setup-reflect-metadata.ts` 经 `setupFiles` 最先加载，polyfill `Reflect.metadata` | `test/setup-reflect-metadata.ts` |
| CJS 静态 import mock 被忽略 | 7 套件（mailer/throttler/ioredis/dns/helpers） | `test/mocks/*` 6 个 CJS mock + `moduleNameMapper` | `test/mocks/`、两 jest config |
| guard 注入缺失 | controller/e2e 套件 | 10 controller spec + 7 e2e 补 `.overrideGuard(JwtAuthGuard)` | 各 spec |
| `@nestjs/axios` ESM-only | 单测/e2e | CJS mock 映射 | `test/mocks/nestjs-axios.mock.ts` |

**CQ-M1 资金一致性修复**（`transactions.service.ts`，本轮已落地 + 全绿验证）：
- `reconcilePendingRecharge` / `handleRechargeCallback` / `applyRechargeSuccess` 三处 `toUserId` 缺失 fail-closed（对称守卫 + 新增 KB708 错误码），移除 3 处 `!` 断言杜绝 `USER:null` 复式账本。

**清理项**：删除遗留 `jest.config.js.bak-cjs-exp` / `bak-nestjs11` / e2e 同款 / 探针文件（共 6 个，git 索引与磁盘双清）。

---

## 2. 安全（security-engineer 产出，`reports/security-audit.md`）

**资金核心 0 P0/P1**：验签先于幂等（纵深防御）、微信代付防假成功、Stripe `timingSafeEqual` 长度归一化、退款乐观锁防双退、幂等键归属校验防越权、密钥 AES-256-GCM + 启动期强制、`npm audit` 0 漏洞。

| 维度 | 评估 |
|------|------|
| A01 注入 | 安全（全 Prisma 参数化） |
| A02 加密失效 | 安全（AES-256-GCM + scrypt + 默认密钥黑名单） |
| A04 越权 | 安全（211/220 端点守卫 + 跨 appId 隔离） |
| A06 CVE | 安全（0 漏洞） |
| A08 资金完整性 | 安全（验签先幂等 + 幂等三路径收敛 + 对账四差异类型） |

**加固项（非高危，建议排期）**：
- M1（P1 质量）：`security` 模块测试覆盖纳入 CI 并设最低门槛。
- M2（P2）：前端 bundle 1.1MB 代码分割（performance-engineer 主导）。
- L1-L6（P2/P3）：mock 通道生产显式禁用、SIEM 告警、nonce 降级路径注释等。

---

## 3. 代码质量（code-quality-reviewer 产出，`reports/code-quality-review.md`）

- **CQ-M1 主体已落地且正确**（资金 `toUserId` 守卫全闭合，tsc 0），唯一缺口是「`toUserId=null` 订单 → SKIPPED+告警」边界单测（qa-engineer 已补入 85/85 全绿套件）。
- **台账更正（主理人声明 vs 磁盘核验）**：
  - ❌ **D15 admin.service 拆 5 子 service 未落地**（`src/admin/admin.service.ts` 仍 1433 行单文件）。
  - ❌ **D16 NestJS ESLint 基线未落地**（无 `.eslintrc`/`eslint.config`，`scripts.lint` 仍 `tsc --noEmit`）。
  - ❌ **D17 资金 6 域 `no-non-null-assertion` 门禁未落地**（6 域现存 `!` 共 45 处未清）。
  - ❌ D2 `.bak-nestjs11` 残留、D3 文档 NestJS 11 漂移、D5 11 个 dependabot 分支——**本轮已清理 D2（bak 文件），D3/D5 仍待落地**。

**关键判断**：代码质量侧的「红灯批次」（admin 拆分 + ESLint 门禁 + 文档对齐 + 分支清理）尚未实施，是下一轮改造的重点。

---

## 4. 技术债（tech-debt-strategist 产出，`reports/tech-debt-refactor.md`）

- **14 项实质债 D1-D17**：4 项 P0（本周必还）/ 6 项 P1（两周）/ 4 项 P2（排期）。
- **最大不确定性 = D1 Jest ESM 全绿**：本轮已清零（测试基线可信），**这是所有后续重构的安全网**。
- **P0 收尾债**（D2 bak 残留 / D3+D12 文档 NestJS 11→12 / D14 推送未同步）：D2/D14 已随本轮推送完成；D3/D12 文档漂移待落地。
- **还债配额**：每 10 个新功能任务配 1 个还债任务（~10%），P0 不占配额本周清零。
- **金融合规唯一缺口**：D10 邮箱验证码走短信（`users.service.ts:502`），建议 P0 并行。

---

## 5. 性能（performance-engineer 产出，`reports/performance-audit.md`）

**21 项问题（H7/M9/L4），头号性能债 = 资金写放大**：

| 问题 | 位置 | 影响 | 优先级 |
|------|------|------|--------|
| P0-7 充值入账事务 6+ 次串行写 | transactions.service.ts:298-364 | 每笔到账 8~10 次 DB 往返 | H |
| P0-8 转账 `moveFundsAndRecord` 8~9 次串行 | transfers.service.ts:280-443 | 每笔转账 ~9 次串行 | H |
| P0-1 风控日计数 OR 全量扫缺复合索引 | risk-engine.service.ts:438-467 | 每笔交易 2 次重扫描 | H |
| P0-2 PENDING 兜底扫描逐笔串行 200 笔 | transactions.schedule.ts:81-112 | 最坏 ~200s > 5min cron，积压 | H |
| P0-20 CI 单测全量 + coverage 同 job | jest.config.js / ci.yml | CI 最贵一步，弱机数十分钟 | H |

**三条最高性价比优化项（投入小、见效大、零正确性风险）**：
1. **P0-17 渠道配置进程内 60s 缓存**（仿 risk-engine `ruleCache`，~40 行）：每笔充值/回调/补单省 1 次 DB 查 + 1 次 AES 解密。
2. **P0-20 CI 提速**（coverage 与正确性解耦 + 模块矩阵并行）：CI 墙钟从数十分钟降到 ~10min，直接回应 e2e 弱机 L 级风险。
3. **P0-1 风控日计数复合索引 + 复用 `DailyLimitUsage`**（schema 加 2 索引 + 改 1 方法）：`riskEngine.check` 每笔交易减 2 次重扫描，高频用户尾延迟直接下降。

---

## 6. 改造/重构建议（主理人汇编，按落地顺序）

> 原则：测试基线（D1）已清零 = 安全网就绪；以下按「零风险 → 低风险 → 中风险」排期，每步 `npm run lint && npm test && npm run test:e2e` 三件套全绿才合入，失败 `git revert` 单 PR 回退。

### 6.1 第一优先：零风险、直接收益（本周，~1 人日）
| # | 建议 | 投入 | 收益 |
|---|------|------|------|
| 1 | P0-17 渠道配置 60s 缓存 | ~40 行 | 资金热路径每笔省 1 DB 查 + AES 解密 |
| 2 | P0-20 CI 提速（matrix + coverage 解耦） | 改 ci.yml/package.json | CI 墙钟砍到 ~10min，解除弱机尾风险 |
| 3 | P0-1 风控复合索引 + `DailyLimitUsage` | schema 2 索引 + 1 方法 | 高频用户尾延迟直接下降，零风险 |
| 4 | D10 邮箱验证码独立通道 | ~0.5 人日 | 金融合规唯一缺口 |

### 6.2 第二优先：代码质量门禁（两周，~2 人日）
| # | 建议 | 投入 | 收益 |
|---|------|------|------|
| 5 | D16 NestJS ESLint 基线 + 资金 6 域 `no-non-null-assertion`/`no-explicit-any` 门禁 | ~1 人日 | CQ-M1 类「不安全 `!`」从 review 兜底变 CI 阻断 |
| 6 | D7 146 处 spec `as any` 收敛（4 个高频文件 51 处先做样板） | ~0.5 人日 | mock 失守风险下降 |
| 7 | security M1：`security` 模块测试纳入 CI + 覆盖率门槛 | 低 | 资金安全模块回归防护 |

### 6.3 第三优先：架构拆分（月度，~2 人日，绞杀者小步）
| # | 建议 | 投入 | 收益 |
|---|------|------|------|
| 8 | D15 admin.service 1433 行拆 5 子 service（用户/提现/实名/渠道/残壳） | ~2 人日 | review 粒度从整文件 diff 降到 300 行内，回归面收窄 |
| 9 | D6 `.env.example` 补 3 个连接池 env + 多副本部署注释 | 低 | 隐性容量债显性化 |
| 10 | D4 `@types/nodemailer` 升匹配 nodemailer 10 | 低 | 类型假绿风险消除 |
| 11 | D3+D12 文档 NestJS 11→12 对齐（10 处） | 低 | 对外口径一致 |
| 12 | D5 清 11 个 dependabot 远程分支 | 低 | 分支噪音清零 |

### 6.4 第四优先：性能深改（容量规划期）
| # | 建议 | 投入 | 收益 |
|---|------|------|------|
| 13 | P0-7/P0-8 资金写放大削减（`ledger/bill` 改 `createMany`/`Promise.all`，事务往返 9→5） | 中 | PG QPS 上限近似 ×1.8 |
| 14 | P0-11 出站渠道并发闸 + 熔断 | 中 | 渠道故障不级联 |
| 15 | P0-14 web-admin echarts 按需 `register` + `manualChunks` | 中 | TTI -300~400KB |

---

## 7. 成员专业报告索引（全部已落盘 `reports/`）

| 报告 | 产出成员 | 核心结论 |
|------|---------|---------|
| `security-audit.md` | security-engineer | 金融 0 P0/P1，8 亮点，6 加固项 |
| `code-quality-review.md` | code-quality-reviewer | CQ-M1 已落地，admin/ESLint 门禁仍红灯 |
| `tech-debt-refactor.md` | tech-debt-strategist | 14 债 D1-D17，D1 全绿为还债门禁 |
| `performance-audit.md` | performance-engineer | 21 项 H7/M9/L4，头号债 = 资金写放大 |
| （Jest ESM 全绿） | qa-engineer | 5 类根因分治，单测 85/85 + e2e 5/5 全绿 |

---

## 8. 本轮交付物清单（已推送 GitHub `x33834/KeBaiPay` @ `b52ab33`）

- Jest ESM 全链路修复（`jest.config.js`、`test/jest-e2e.config.js`、`test/esm-resolver.cjs`、`test/setup-reflect-metadata.ts`、`test/mocks/*` ×6、10 controller spec + 7 e2e 补 guard）
- CQ-M1 资金一致性（`transactions.service.ts`、`error-codes.ts`、`notifications.module.ts`）
- 5 份专业评审报告（`reports/*.md`）
- 清理遗留 bak/probe 文件

## 9. 给用户的 3 条行动建议（按性价比）

1. **先落 6.1 的 3 条零风险项**（P0-17 / P0-20 / P0-1 + D10）：投入 < 1 人日，直接惠及资金热路径 + CI + 合规，是本轮「最该马上做」的事。
2. **再建 ESLint 资金门禁（6.2 #5）**：把 CQ-M1 类「不安全 `!`」从人工 review 兜底固化为 CI 阻断，金融项目最划算的一道防线。
3. **架构拆分（admin God Object）排月度**：绞杀者小步路径，每步 300 行 diff 可机审 + 单 PR 可回退，不急于本周。
