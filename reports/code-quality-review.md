# KeBaiPay 代码质量台账重核验（CQ-M1 落地确认版）

- 审查人：code-quality-reviewer（team `kebaipay-audit`）
- 仓库：`C:/Users/X1882/WorkBuddy/2026-09-22-11-14-28/KeBaiPay`（路径可达，已 clone，node_modules 已装，tsc 已清零）
- 本版说明：上一版审查基于「代码库不可达」做了推断，本轮已按主理人纠正**逐项 Read 磁盘文件**复核，
  把 CQ-M1 的「已落地」与「仍 [红灯批次]」彻底分清。结论先行：**CQ-M1 主体已落地且正确，
  但主理人声明里混入了两条尚未落地的项（admin God Object 拆分、ESLint 门禁），台账需更正。**

---

## 块 1：CQ-M1 修复落地确认（资金路径 Major）

已逐项核对 `git status`（仅 3 个文件处于 modified：error-codes / notifications.module /
transactions.service，均为 CQ-M1 相关，未提交）与磁盘内容：

| 落地项 | 文件 / 位置 | 磁盘核验结果 | 判定 |
|---|---|---|---|
| 幂等命中对称 toUserId 守卫 | `transactions.service.ts` L64–68（`recharge`） | `existing.toUserId !== userId` → `IDEMPOTENCY_KEY_CONFLICT` | ✅ 已落地 |
| P2002 并发幂等路径对称守卫 | 同上 L116–124 | catch Prisma P2002 后查回 existing，`toUserId` 不一致 → `IDEMPOTENCY_KEY_CONFLICT` | ✅ 已落地 |
| 回调 toUserId 缺失 fail-closed | `handleRechargeCallback` L213–218 | `!order.toUserId` → error 日志 + `CALLBACK_TO_USER_MISSING`，不进入账 | ✅ 已落地 |
| 补单 reconcile toUserId 对称守卫 | `reconcilePendingRecharge` L391–396 | `!order.toUserId` → `SKIPPED` + error 告警人工（与 channelOrderNo 缺失同口径） | ✅ 已落地 |
| `applyRechargeSuccess` null 兜底双保险 | L306–308 | `!order.toUserId` 立即抛 `CALLBACK_TO_USER_MISSING`，杜绝 `!` 写 `USER:null` 复式账本 | ✅ 已落地 |
| KB708 文案补齐 | `error-codes.ts` L132 + L380 | `CALLBACK_TO_USER_MISSING: 'KB708'` 常量 + `订单无归属用户，拒绝入账` 文案 | ✅ 已落地 |
| 内部冗余 `!` 消除 | `applyRechargeSuccess` 全函数 | 原 L296/L333/L346/L349 的 `order.toUserId!` 已无残留（函数体已重写） | ✅ 已落地 |
| **边界单测（toUserId=null → SKIPPED+告警）** | `transactions.service.spec.ts` | 现有 spec 全部 `toUserId: 'u1'`（必填），**未见 null/缺失 用例** | ❌ 未落地（qa-engineer 负责项） |

**结论：CQ-M1 代码修复完整正确、资金路径闭合，tsc 已回 0。唯一缺口是边界单测，属 QA 职责，不阻断。**

tsc 基线复核：`npx tsc --noEmit` → exit 0（无错误输出）。

---

## 块 2：台账 14 项债务 + ESLint 门禁 落地状态对照

> 主理人声明里「admin God Object 拆为 5 子 service + tsconfig.eslint.json/.eslintrc.js 引入
> ESLint」两条，经磁盘核验**均未落地**。以下为逐项真伪对照（已落地 ✅ / 待落地 ❌）。

### 2.1 已落地（代码侧，本轮 tsc 验证范围内）

| 项 | 来源 | 磁盘状态 |
|---|---|---|
| D4 `@types/nodemailer` 跨 major 漂移 | 依赖债 | 已通过 notifications.module.ts 显式收敛 `MailerOptionsShape` 返回类型 + `config.get<string>` 绕过 nodemailer10/types8 结构差异；**属「绕过式兼容」非根治**，根因仍待 D4 升级 @types 对齐（标 ✅绕过 / ❌根治） |
| CQ-M1 toUserId 资金守卫 | CQ 同步 | ✅ 已落地（见块 1） |

### 2.2 仍 [红灯批次] / 未落地（需更正台账）

| 项 | 台账 | 磁盘核验 | 判定 |
|---|---|---|---|
| **D15 admin.service 拆 5 子 service** | PR #4.5 排期 | `src/admin/admin.service.ts` 仍为**单文件 1433 行**，`src/admin/` 目录无 `AdminUserAdminService`/`AdminWithdrawalService`/`AdminRealNameService`/`AdminChannelConfigService` 任何文件（grep 全仓 0 命中） | ❌ **未落地**（主理人声明有误） |
| **D16 引入 NestJS ESLint 基线** | PR #4 排期 | 无 `.eslintrc.js`、无 `tsconfig.eslint.json`（find 全仓 0 命中）、`package.json` 无任何 `eslint` 依赖、`scripts.lint` 仍为 `tsc --noEmit` | ❌ **未落地**（主理人声明有误） |
| **D17 资金 6 域 `no-non-null-assertion` 门禁** | PR #4 排期 | `no-non-null-assertion` 全仓 0 命中；6 资金域现存非 null 断言 `!` 共 **45 处**（transactions 0、finance 3、withdrawals 5、batch-transfers / escrow / splits 大量）——**门禁未上，存量未清** | ❌ **未落地**（主理人声明有误） |
| CQ-m1 冗余 `!`（channel-reconciliation L134/148、finance L51/159/167、qr-codes L129、auth L76） | 可选优化 | 逐处仍在磁盘：`o.channelOrderNo!` L134/148、`order.completedAt!` L51、`item.paidAt!/reviewedAt!` L159/167、`qrCode.amount!` L129、`dto.email!` L76 | ❌ 未落地 |
| CQ-m2 `as any`（refund 枚举 `'REFUND' as any`、agent/*） | 可选 | 未消除（非资金主路径，判保留注释可接受） | ❌ 未落地（可接受） |
| CQ-m5 `users.service.ts` L502 邮箱验证码走短信 TODO | D10 | L502 `TODO: 项目当前仅有短信通道` 仍在 | ❌ 未落地 |
| D1 Jest ESM 全量基线全绿 | P0 | **不在本人职责内**（主理人正在攻坚，ci-cd worker 已 stall） | ⛔ 不核验 |
| D2 `.bak-nestjs11` 残留 | P0 | 根目录 `jest.config.js.bak-nestjs11` 仍在 | ❌ 未落地 |
| D3 文档 NestJS 11 漂移 | P0 | 未清（本轮未改文档） | ❌ 未落地 |
| D5 11 个 dependabot 远程分支 | P1 | 未清 | ❌ 未落地 |
| D6 连接池 3 env 兜底 | P1 | `.env.example` 未补 | ❌ 未落地 |
| D7 146 处 spec `as any` | P1 | 未收敛 | ❌ 未落地 |
| D8/D9/D11/D13/D14 | P1/P2 | 未动 | ❌ 未落地 |

---

## 块 3：对主理人声明的更正（3 条事实性修正）

1. **「admin God Object 拆为 5 子 service 已落地」= 错误。** 磁盘上 `admin.service.ts` 仍是
   1433 行单体，无任何子 service 文件。该项在台账里本就是 PR #4.5 **排期项**（红灯批次），
   并非已落地。请撤下「已落地」标记。
2. **「tsconfig.eslint.json / .eslintrc.js 引入 ESLint 已落地」= 错误。** 全仓既无 ESLint 配置
   文件，也无 `eslint` 依赖，`lint` 脚本仍等于 `tsc --noEmit`。D16/D17 仍是 [红灯批次]。
3. **真正确认落地的只有 CQ-M1 资金守卫 + KB708 + notifications.module 的 nodemailer 兼容收敛。**
   主理人把「待排期项」误写成了「已落地项」，台账需按块 2.2 回滚这三条到 [红灯批次]。

---

## 块 4：重构优先级建议（最小改动优先，不越 QA/CICD 职责）

| 优先级 | 动作 | 理由 / 代价 |
|---|---|---|
| P0-必须 | 给 `reconcilePendingRecharge`/回调 `toUserId=null` 补 1 个边界单测（qa-engineer） | 资金路径无单测兜底，CQ-M1 修复缺验收；现有 spec 全是 `toUserId:'u1'`，null 分支零覆盖 |
| P0-必须 | D1 Jest ESM 全绿（主理人/CI-CD） | 测试基线未绿前，CQ-M1 修复也无行为验收；还债门禁前置 |
| P1-排期 | 撤下 D15/D16/D17 的「已落地」误标，保持红灯批次；落地顺序 D17 存量先清（6 域 45 处 `!`）再上门禁 | 门禁上线前存量必清，否则 CI 首跑即红；现存 `!` 大多有上游守卫但应逐处改窄化 |
| P1-排期 | admin.service 拆分（D15）置于 D17 门禁之下做，每步 300 行 diff | 门禁可机审；当前 1433 行单体是长期 Major 债 |
| 可选 | CQ-m1 冗余 `!`（10 处）随 D17 清理顺带做 | 纯可读性，`<3` 行/处 |

**复核底线声明**：本轮全部结论基于磁盘文件 Read（非推断）。CQ-M1 资金修复本身**质量合格**，
无需返工；被更正的是「台账里 CQ-m3/m4/ESLint 的门禁项被误记为已落地」这一状态标注问题。

> 备注：`src/settlement*/` 依旧不存在，结算逻辑在 `src/notifications/settlement.service.ts`，
> 与上一版一致。
