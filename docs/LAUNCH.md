# KeBaiPay 开源发布准备清单

> 本文档由项目收尾人编写，作为开源发布前的最终检查与操作指南。

---

## 一、发布前检查清单

### 1.1 代码与配置

| # | 检查项 | 状态 | 备注 |
|---|---|---|---|
| 1 | `.env.example` 已更新，不含真实密钥 | ✅ | 仅含占位符 |
| 2 | `dist/` 构建产物已清理 | ✅ | 已删除各 dist 目录 |
| 3 | `node_modules/` 已清理 | ✅ | .gitignore 已覆盖 |
| 4 | `demo/videos/` 大文件已 gitignore | ✅ | 已添加 demo/videos/ |
| 5 | `package-lock.json` 未提交 | ✅ | .gitignore 已覆盖 |
| 6 | `.github/workflows/dependabot-auto-merge.yml` 已删除 | ✅ | 与 CONTRIBUTING 冲突 |
| 7 | `.github/dependabot.yml` 已禁用自动更新 | ✅ | 改为注释说明 |
| 8 | `.github/CODEOWNERS` 已更新 | ✅ | 按模块分配维护者 |
| 9 | `.prettierrc` 已创建 | ✅ | 统一格式化规则 |
| 10 | `jest.config.js` 已添加覆盖率配置 | ✅ | 分支 70% / 函数 75% |

### 1.2 文档一致性

| # | 检查项 | 当前值 | 目标值 | 状态 |
|---|---|---|---|---|
| 1 | README CI 徽章 | weed33834/KeBaiPay | ✅ | 已修复 |
| 2 | README clone 命令 | weed33834/KeBaiPay | ✅ | 已修复 |
| 3 | README 三平台表格 GitHub 行 | weed33834/KeBaiPay | ✅ | 已修复 |
| 4 | README tests 徽章链接 | docs/CHANGELOG.md | ✅ | 已修复（原为 GitCode 错误链接） |
| 5 | package.json homepage | github.com/weed33834/KeBaiPay | ✅ | 已修复 |
| 6 | package.json repository | github.com/weed33834/KeBaiPay | ✅ | 已修复 |
| 7 | package.json bugs | github.com/weed33834/KeBaiPay | ✅ | 已修复 |
| 8 | .github/ISSUE_TEMPLATE/config.yml | weed33834/KeBaiPay | ✅ | 已修复 |
| 9 | CONTRIBUTING.md 主仓库 | weed33834/KeBaiPay | ✅ | 无需改动 |
| 10 | SECURITY.md 主仓库 | weed33834/KeBaiPay | ✅ | 无需改动 |

### 1.3 许可证与合规

| # | 检查项 | 内容 | 状态 |
|---|---|---|---|
| 1 | LICENSE 文件 | PolyForm Noncommercial 1.0.0 | ✅ |
| 2 | Copyright 声明 | `badhope / Morningstar202604` | ✅ |
| 3 | README 许可证说明 | 非商用免费，商用需授权 | ✅ |
| 4 | CONTRIBUTING.md 商用条款 | 明确标注 | ✅ |
| 5 | FUNDING.yml | 不接受赞助，欢迎其他贡献 | ✅ |

### 1.4 版本一致性

| # | 检查项 | 值 | 状态 |
|---|---|---|---|
| 1 | root package.json version | 2.2.1 | ✅ |
| 2 | web package.json version | 2.2.1 | ✅ |
| 3 | web-h5 package.json version | 2.2.1 | ✅ |
| 4 | web-admin package.json version | 2.2.1 | ✅ |
| 5 | README version badge | 2.2.1 | ✅ |
| 6 | CHANGELOG.md latest | v2.2.1 (2026-08-26) | ✅ |

---

## 二、本项目使用的许可证说明

### 许可证类型：PolyForm Noncommercial License 1.0.0

**核心要点：**

| 允许 | 禁止 |
|---|---|
| 学习研究 | 商业使用（SaaS、付费产品等）|
| 教学演示 | 未经授权的商用集成 |
| 个人部署 | 使用版权方名称做推广 |
| 修改分发 | 不使用相同许可证 |
| 必须保留版权声明 | |
| 必须包含许可证全文 | |
| 修改后必须用相同许可证 | |
| 修改后必须标注原作者 | |

**商业用途联系：** 请联系 GitHub 账号 `weed33834` 或 `Morningstar202604` 获取书面授权。

**学习使用：** 无需联系，直接使用，遵守许可证条款即可。

---

## 三、修改与分发要求

任何基于本项目的修改和分发，必须遵守以下要求：

1. **保留版权信息**：LICENSE 文件和 Copyright 声明不得删除或修改
2. **保持相同许可证**：修改版本必须继续使用 PolyForm Noncommercial 1.0.0
3. **标注原作者**：在修改文件中注明原始作者和来源（GitHub: weed33834/KeBaiPay）
4. **禁止商业背书**：不得使用 KeBaiPay 品牌或作者名称进行产品推广
5. **遵守安全披露**：发现漏洞通过 [GitHub Security Advisories](https://github.com/weed33834/KeBaiPay/security) 私下报告，勿公开

---

## 四、Logo 与品牌说明

### 当前状态

- **Logo**：使用文字 `💳 KeBaiPay 科佰支付`，无独立图形 Logo 文件
- **图标**：README 和文档中使用 emoji（💳、🚀、✨ 等），无 PNG/SVG 文件
- **Favicon**：暂不提供，后续如有需求可补充

### 如需修改

本项目未托管独立的 Logo 图片文件，品牌标识以文字 + emoji 形式呈现。

如需定制 Logo 用于商业项目，请联系版权持有者获取官方授权素材包。

---

## 五、多平台仓库说明

| 平台 | 地址 | 定位 |
|---|---|---|
| **GitHub（主仓库）** | [weed33834/KeBaiPay](https://github.com/weed33834/KeBaiPay) | 主要开发平台，Issues / PR / CI |
| Gitee | [badhope/kebaipay](https://gitee.com/badhope/kebaipay) | 国内镜像，方便国内开发者访问 |
| GitCode | [badhope/KeBaiPay](https://gitcode.com/badhope/KeBaiPay) | 备用镜像 |

> **注意**：三平台内容应保持同步，主要开发在 GitHub 上进行。

---

## 六、发布检查命令

```bash
# 1. 检查 TypeScript 类型错误
npm run lint

# 2. 运行测试并查看覆盖率
npm run test:cov

# 3. 检查版本一致性
npm run version:check

# 4. 格式化检查
npx prettier --check "src/**/*.ts" "test/**/*.ts" "*.md"

# 5. 查看 git 状态（确认没有遗漏文件）
git status --short

# 6. 检查 .gitignore 是否生效
git check-ignore -v dist/ node_modules/ demo/videos/
```

---

## 七、发布后维护指南

### 日常维护

1. **依赖更新**：每月人工执行 `npm audit` 和 `npm outdated`，评估后手动升级
2. **CI 监控**：确保 CI 流水线持续通过（[CI 状态](https://github.com/weed33834/KeBaiPay/actions)）
3. **Issue 响应**：48 小时内响应 Issue，安全漏洞 24 小时内响应
4. **文档同步**：任何代码变更需同步更新相关文档

### 版本发布流程

1. 修改 `docs/CHANGELOG.md` 添加新版本记录
2. 执行 `npm run version:sync` 同步所有 package.json 版本号
3. 提交版本变更，打 Git Tag（如 `v2.3.0`）
4. 发布 GitHub Release，附更新说明
5. 同步推送到 Gitee 和 GitCode 镜像

### 社区贡献

1. Fork 主仓库 → 创建功能分支 → 提交 PR
2. PR 标题遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范
3. 所有 PR 需通过 CI 检查
4. 至少一名 CODEOWNERS 成员审核批准

---

## 八、安全说明

### 已知安全策略

- 渠道凭据采用 AES-256-GCM 信封加密存储
- `appSecret` 只存 SHA-256 哈希值
- OpenAPI 使用 HMAC-SHA256 签名 + 时间窗 + nonce
- Webhook 处理包含 SSRF 防护
- 敏感配置从环境变量注入，不落盘明文

### 漏洞报告

请勿通过公开 Issue 报告安全漏洞。请使用 [GitHub Security Advisories](https://github.com/weed33834/KeBaiPay/security) 私下披露。

---

## 九、合规提示

> ⚠️ 本项目含平台内钱包账本设计，在中国大陆直接运营涉及**无证支付业务红线**。
> 生产部署前请阅读 [专家面板评估报告](docs/EXPERT_PANEL_ASSESSMENT.md)。
> 默认仅提供 mock 渠道，不具备真实支付能力。

---

## 十、快速上手（复现）

```bash
# 克隆主仓库
git clone https://github.com/weed33834/KeBaiPay.git && cd KeBaiPay

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env

# 启动数据库和缓存
docker compose -f docker-compose.dev.yml up -d

# 初始化数据库
npx prisma migrate deploy && npx prisma db seed

# 启动开发服务器
npm run start:dev

# 构建前端
cd web && npm install && npm run build
cd ../web-h5 && npm install && npm run build
cd ../web-admin && npm install && npm run build
```

---

**最后更新**：2026-09-04  
**项目版本**：v2.2.1  
**发布状态**：✅ 已完成开源发布准备
