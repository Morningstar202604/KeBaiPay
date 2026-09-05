# KeBaiPay 版本管理规范（SemVer）

> 生效日期：2026-08-26 ｜ 适用范围：根 package.json + web/ + web-h5/ + web-admin/

## 1. 单一版本源（Single Source of Truth）

**根 `package.json` 的 `version` 字段是全仓唯一权威版本号。**

- `web/`、`web-h5/`、`web-admin/` 三个前端的 `package.json` 版本号**禁止独立修改**，
  一律由脚本从根版本同步：`npm run version:sync`。
- 提交前用 `npm run version:check` 校验一致性（CI 建议接入，不一致直接红）。

## 2. 语义化版本规则（严格 SemVer：MAJOR.MINOR.PATCH）

| 位 | 何时递增 | 典型场景 | 示例 |
|---|---|---|---|
| **PATCH（第三位）** | 纯修复，不新增用户可见能力 | Bug 修复、安全修复、性能优化、文档修正、依赖小升级 | 修复回调金额校验漏洞 → `0.2.0 → 0.2.1` |
| **MINOR（第二位）** | 向后兼容的新功能 | 新业务模块、新 API 端点、新前端页面、新渠道连接器、非破坏性 schema 迁移（只加表/加列） | 上线订阅产品化页面 → `0.2.x → 0.3.0` |
| **MAJOR（第一位）** | 破坏性变更 | API 契约不兼容改动、删除/重命名端点、需要数据迁移或停机窗口的 schema 变更、配置项不兼容、最低 Node/PG 版本提升 | 首个稳定版发布 → `0.x → 1.0.0` |

### 判定口诀

```
改了代码但使用者无感知新能力？        → PATCH
能"用"到新东西但旧用法完全不受影响？  → MINOR
旧集成代码会因此编译失败/行为断裂？    → MAJOR
```

**纪律要求**：

1. **日常开发默认 PATCH。** 连续多个修复各自发 `0.2.1 / 0.2.2 / 0.2.3…`，
   禁止把一批修复打包成 `0.3.0` 冲高次版本号。
2. MINOR 必须有对应 CHANGELOG 的"新增"条目支撑；凑不出新功能条目就不许动第二位。
3. MAJOR 必须附迁移指南（`docs/` 下新增 `MIGRATION-vX.md`）。
4. 预发布版本用 SemVer 后缀：`0.3.0-beta.1`、`0.4.0-rc.1`。
5. **首个稳定版之前 MAJOR 保持 0。** 尚未正式发布 1.0.0 前，破坏性变更不提升 MAJOR（保持为 0），
   仅在发布首个稳定版时才进入 1.0.0。

## 3. 发版操作流程

```bash
# 1) 确认 CHANGELOG.md 已有对应版本的完整条目（见第 4 节）

# 2) 在仓库根目录按变更类型升版本
npm version patch --no-git-tag-version   # 或 minor / major

# 3) 同步三前端版本号并自检
npm run version:sync
npm run version:check

# 4) 打 tag 并推送（tag 名与版本号一致）
git tag v$(node -p "require('./package.json').version")
git push && git push --tags
```

## 4. CHANGELOG 规范

- 每个对外发布的版本在 `docs/CHANGELOG.md` 有独立章节，标题格式：
  `## 版本 X.Y.Z（YYYY-MM-DD）`；开发中的变更先挂在 `## 版本 X.Y.Z（进行中）` 下。
- 条目分三类标注：**新增**（MINOR 支撑材料）/ **修复**（PATCH）/ **破坏性变更**（MAJOR）。
- 版本章节一旦正式发布不再追加内容；后续问题走下一个 PATCH。

## 5. 与分支/标签的关系

- `main` 分支永远等于最新已发布版本 + 进行中的下一版本。
- 版本 tag 只打在 main 上；历史问题修复一律前进式修复（fix forward），不维护多 LTS 分支。
- tag 命名 `vX.Y.Z`（带 v 前缀），与 `git describe` 输出兼容。

## 6. 历史遗留对齐说明

早期评审发现三处版本漂移：根 `2.2.0` / 三前端 `2.3.0` / CHANGELOG `2.2.1（进行中）`。
后续版本基线统一收敛为 **0.2.1**（以根 `package.json` 为准），历史 2.x 条目归档保留。
此后以本文档规则执行。
