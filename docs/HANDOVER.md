# KeBaiPay 企业交付说明（HANDOVER）

> 版本基线：v0.2.1（分支 `fix/dev-setup-and-openapi-signing`，PR #45）
> 生成日期：2026-09-06 ｜ 本文档面向接手部署与二次开发的企业技术团队

---

## 1. 系统概览

KeBaiPay 科佰支付是一套自托管支付中台参考实现，单体后端承载 35 个业务模块（NestJS 11 + TypeScript + Prisma 7 + PostgreSQL 16 + Redis 7），另带三个 Vue 3 前端与一个 AI Agent 层（含 MCP Server）。

| 入口 | 地址 | 说明 |
|---|---|---|
| 用户端 H5 | `http://<host>:3001/h5/` | 钱包/充值/转账/提现/红包/AI 助手 |
| 商户门户 | `http://<host>:3001/portal/` | 商户入驻/应用/订单/对账 |
| 管理后台 | `http://<host>:3001/admin/` | 审核/风控/财务/渠道配置 |
| 原版演示 SPA | `http://<host>:3001/` | 单文件版收银台演示 |
| Swagger | `http://<host>:3001/api/docs` | 仅非生产环境挂载 |
| OpenAPI 规范 | `docs/openapi.json` | 192 个端点 / 76 个模型（可直接导入 Apifox/Postman） |
| Prometheus 指标 | `http://<host>:3001/metrics` | 建议内网限制 |

## 2. 快速部署

```bash
git clone <repo> && cd kebaipay
cp .env.example .env          # 按第 3 节逐项核对
docker compose -f docker-compose.dev.yml up -d   # PG16 + Redis7（生产用 docker-compose.yml）
npx prisma migrate deploy && npx prisma db seed
npm run build
node dist/main                # 或 npm run start:dev（开发）
```

前置要求：Node ≥ 20、Docker。国内网络拉不动 Docker Hub 时可用镜像源：
`docker pull docker.m.daocloud.io/library/postgres:16-alpine && docker tag ... postgres:16-alpine`（redis 同理）。

## 3. 必改环境变量（生产 checklist）

| 变量 | 要求 |
|---|---|
| `NODE_ENV` | **必须 `production`**（本地开发才用 development） |
| `JWT_USER_SECRET` / `JWT_ADMIN_SECRET` / `JWT_AGENT_SECRET` | 三套独立随机值（≥32 字符），用默认值服务拒绝启动 |
| `ENCRYPTION_KEY` | ≥32 字符随机值（加密身份证/银行卡/渠道凭据） |
| `ADMIN_DEFAULT_PASSWORD` | 首次登录后立即修改 |
| `POSTGRES_PASSWORD` | 强密码（compose 与 `DATABASE_URL` 共用同一变量） |
| `REDIS_URL` | 生产必填；缺失时资金操作直接抛错（fail-closed） |
| `SMS_PROVIDER` | 生产禁用 mock，配 aliyun/tencent/huawei 及密钥 |
| `MOCK_CHANNEL_SECRET` | mock 渠道仅限开发/测试 |
| `CORS_ORIGINS` | 改为实际域名 |

## 4. 测试账号（seed 预置）

- 用户 `13800000001` / `Abc12345`（支付密码 `123456`）
- 管理员 `admin` / 密码取 `.env` 的 `ADMIN_DEFAULT_PASSWORD`（example 默认 `ChangeAdmin2026`）

## 5. 验证状态（2026-09-06）

- `tsc --noEmit` 0 错误；单元测试 **77 套件 / 1178 用例**通过；E2E **5 套件 / 49 用例**通过
- GitHub Actions CI 全绿（含空库迁移冒烟）
- 真实环境冒烟：登录 → 余额 → mock 充值 → 签名回调入账 → 幂等重放不重复入账
- 四端 UI 均真实构建并打开验证（H5 登录+首页数据流全通；路由切换在无渲染帧的自动化测试环境存在过渡卡死现象，dev 模式同一页面渲染正常，建议在真实浏览器人工复核一遍各页面）

## 6. 已修复的安全/资金缺陷（本轮审查，PR #45）

1. 开放 API HMAC 密钥口径（服务端 vs SDK 不一致，商户接入必 401）
2. 管理员账号端点权限提升（客服角色可建超管）→ 新增 `admin:manage` 权限
3. 批量转账不验支付密码、取消双花、崩溃恢复盲区
4. 订阅重复扣款/首扣失败当成功/失败重试死循环/复活已取消订阅
5. Agent 授权单笔限额未执行、日限额时区窗口绕过
6. 管理端响应泄露密码哈希、渠道凭据明文入审计链
7. 银行卡默认卡接口返回明文卡号
8. 退款链资金单边账、三路径并发双扣、对账公式漏计退款
9. 多处事务内外呼、调度无锁、扫描无界、幂等归属校验缺失
10. E2E Windows 兼容、lockfile 版本漂移、dev compose 密码脱节等工程问题

## 7. 已知限制与待办（交付前需知悉）

| 项 | 说明 | 建议 |
|---|---|---|
| **许可** | PolyForm Noncommercial 1.0.0——**商用需版权方书面授权** | 对接企业前必须解决 |
| 支付渠道 | 默认仅 mock；微信/支付宝官方 SDK 已接但需真实商户号联调 | UAT 用真实渠道小额跑通 |
| Stripe/银联 Connector | 骨架状态 | 按需开发 |
| finance 报表口径 | UTC（快照内部自洽），与业务时区日切不一致 | 列入 P0-6 后续批次 |
| 优惠券核销 | `useUserCoupon` 信任调用方自报订单数据（当前无资金路径） | 接入支付事务时改造 |
| 银行卡哈希列 | 无密钥 pepper 的裸 SHA-256（库泄露可离线穷举） | 加 pepper 需数据迁移，单独立项 |
| 真实浏览器 UI 复核 | 自动化环境无法完成渲染帧级别的路由过渡验证 | 人工过一遍四端主流程 |
| E2E 手工验证 | 登录后 H5 账单页建议人工点一遍（见第 5 节说明） | 同上 |

## 8. 开发纪律（接手团队必读）

详见 `CONTRIBUTING.md`、`docs/DEVELOPER_GUIDE.md`、`docs/VERSIONING.md`，要点：

- `main` 受保护；`feat/*`、`fix/*` 分支 + 约定式提交
- 资金代码铁律：`$transaction` + `withLock` + 条件原子更新 + 幂等键（含归属校验）+ 并发测试
- PR 前：`npm run lint && npm test` + 三前端 `npm run typecheck` + `npm run version:check`
- 版本：根 `package.json` 唯一版本源，日常 PATCH，`npm run version:sync` 同步（含 lockfile）
- 新增端点更新 `docs/API_REFERENCE.md`；新增模型必须建 migration
