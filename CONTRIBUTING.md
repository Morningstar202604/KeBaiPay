## Working rules for this repository

* Dependency updates: search the whole repository for every occurrence of a dependency (build files, lockfiles, CI workflows, docs) before bumping. A partial bump — declaration updated but lockfile or a pinned action left behind — is the most common cause of "works locally, CI fails". Keep lockfiles in the same commit as the declaration. Move version-coupled toolchain upgrades together in one commit.
* Refactoring: pull latest main first, work on a fresh branch, keep commits atomic with messages that state the why, and always run the full check suite before pushing (for this repo: `npm run lint && npm test`, plus `npm run typecheck` in each of `web/`, `web-admin/` and `web-h5/`). A branch left behind main cannot be merged under the repository's branch protection.
* Merge conflicts: resolve conflicts in the working tree against the latest main; never force-push shared branches; never resolve a conflict by blindly taking either side — re-read both sides and keep both changes when they are both valid.
* Versioning: releases follow X.Y.Z starting at 0.0.0. Last digit = fixes, middle digit = feature work, first digit stays 0 until a stable release is declared. Bump the version in code, CHANGELOG.md and the tag in the same change.

---

# 贡献者公约 — KeBaiPay

感谢您参与 KeBaiPay 开源项目！本文档列出当前贡献者名单与协作约定。

## 代码托管平台

本项目托管于 GitHub，**内容以主仓库为准**：

| 平台 | 地址 | 适用场景 |
|---|---|---|
| GitHub | https://github.com/Morningstar202604/KeBaiPay | 协作、CI 自动化、Issue/PR 主入口 |

- **主仓库**为 GitHub。CI 自动化在 GitHub 运行（`.github/workflows/`）
- 提交 PR 请在 GitHub 主仓库发起
- Issue 请在 GitHub 提交

## 核心贡献者

| 平台 | 角色 | 职责 |
|---|---|---|
| [@Morningstar202604](https://github.com/Morningstar202604)（GitHub） | 项目负责人 / 架构师 | 整体架构、资金安全审查、技术选型、API 契约 |
| [@KEBAI-CN](https://github.com/KEBAI-CN) | 联合开发者 | 功能开发、测试、文档、AI 智能体层、前端 |

## 如何贡献

### 提交 Issue

- Bug 报告请附上：复现步骤、预期行为、实际行为、环境信息（Node 版本 / 数据库版本 / LLM Provider）
- 安全漏洞请**勿**在公开 Issue 中提交，请见 [SECURITY.md](./SECURITY.md)
- Feature Request 请描述使用场景与期望的 API 形态

### 提交 Pull Request

1. Fork 仓库并创建分支：`feat/your-feature` 或 `fix/your-bugfix`
2. 遵循现有代码风格（NestJS 模块化 + TypeScript 严格模式）
3. 资金相关代码（transfers / withdrawals / red-packets / escrow / agent 工具）必须包含单元测试
4. 新增 API 端点必须更新 `docs/API_REFERENCE.md`
5. 新增 Prisma 模型必须创建 migration：`npx prisma migrate dev --name xxx`
6. PR 标题遵循约定式提交：`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`
7. CI 通过后由人工 review 合并（**不开启自动合并**）

### 分支策略

- `main` — 稳定分支，受保护
- `feat/*` — 新功能开发
- `fix/*` — Bug 修复
- `release/*` — 发布分支

### 提交规范

```
<type>(<scope>): <subject>

<body>
```

- `type`: feat / fix / refactor / docs / test / chore / perf
- `scope`: 模块名（auth / transfers / agent / llm 等，可选）
- `subject`: 简明描述

示例：
```
feat(agent): 支持 kbpay_query_merchant_balance 工具
fix(llm): dotenv 环境变量显式转 number，修复 AbortSignal.timeout 报错
docs(readme): 更新 AI 智能体层介绍
```

## 依赖更新策略

- **手动更新**，不使用 Dependabot / Renovate 等自动依赖机器人
- 每月由维护者人工执行 `npm audit` + `npm outdated`，评估升级风险后提交 PR
- 大版本升级（NestJS / Prisma / AI SDK）需单独创建 upgrade PR + 完整回归测试

## 代码审查规则

1. 资金相关代码（转账/提现/红包/担保/Agent 工具）必须至少 1 名维护者 review
2. 安全相关代码（认证/加密/风控）必须由项目负责人 review
3. AI 智能体工具新增/修改必须更新 [tool.registry.ts](src/agent/tools/tool.registry.ts) 的权限矩阵

## 开发环境

详见 [docs/QUICKSTART.md](docs/QUICKSTART.md) 和 [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)。

## License

本项目采用 [PolyForm Noncommercial 1.0.0](./LICENSE) 许可：**允许**学习、研究、教学及一切非商业使用；**禁止**任何商业用途（含 SaaS 分发、商业产品集成、付费托管服务）。商业授权需版权持有者书面同意。提交贡献即表示您同意将所贡献内容按本许可授权。
