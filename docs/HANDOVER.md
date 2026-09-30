# KeBaiPay 企业交付说明（HANDOVER）

> 版本基线：v0.3.5（合规聚合模式）
> 生成日期：2026-09-30 ｜ 本文档面向接手部署与二次开发的企业技术团队

---

## 1. 系统定位

KeBaiPay 是一套**可私有化部署的合规聚合收单技术服务参考实现**：

- 持牌通道收单（微信/支付宝/mock）
- 商户入网审核与 KYC
- 开放 API（HMAC-SHA256）
- 渠道账单逐笔对账
- AI 智能体运营助手
- 审计哈希链

**资金绝不过平台**：不设余额、不设充值、不设提现、不设转账、不设红包、不设分账、不设担保。所有资金由持牌支付机构直接清算。

---

## 2. 功能矩阵（开箱即用）

| 能力 | 状态 | 说明 |
|---|---|---|
| 持牌通道收单（微信/支付宝/mock） | ✅ | 默认 mock 开箱即跑 |
| 商户入驻审核 | ✅ | 管理后台人工审核 |
| 用户实名认证 | ✅ | KYC 双端 UI |
| 开放 API（创建/查单/退款/统计） | ✅ | HMAC-SHA256 |
| 收银台 + 收款码 | ✅ | H5 端 |
| 渠道账单对账 | ✅ | 定时拉单 + 逐笔匹配 |
| 退款原路退回 | ✅ | |
| 优惠券 | ✅ | |
| 发票 | ✅ | |
| AI 智能体 + MCP | ✅ | 需配置 LLM |
| 审计哈希链 | ✅ | |
| Prometheus /metrics | ✅ | |
| 用户余额 / 钱包 | ❌ | 已物理删除 |
| 充值 / 提现 / 转账 / 红包 | ❌ | 已物理删除 |
| 担保 / 分账 / 批量代付 | ❌ | 已物理删除 |
| 订阅扣款 / 邀请返现 | ❌ | 已物理删除 |

---

## 3. 技术栈

- 后端：NestJS 11 + TypeScript + Prisma 7 + PostgreSQL 16 + Redis 7
- 前端：Vue 3（H5 / Portal / Admin 三端）
- AI：Vercel AI SDK + MCP Server
- 部署：Docker Compose

---

## 4. 端点规模

- **136 个操作 / 121 条路径**（与代码实测一致）
- 机器可读：`docs/openapi.json`
- 人类可读：`docs/API_REFERENCE.md`

---

## 5. 交付物清单

| 类别 | 路径 |
|---|---|
| 源码 | `src/`、`web/`、`web-admin/`、`web-h5/` |
| 数据库 | `prisma/schema.prisma`、`prisma/migrations/` |
| 文档 | `docs/`（本目录） |
| 部署 | `docker-compose.yml`、`Dockerfile`、`nginx/` |
| 演示 | `demo/` |
| 法律文本 | `docs/legal/` |

---

## 6. 验收清单

- [ ] `npm run build` 通过
- [ ] `npm run lint`（tsc --noEmit）通过
- [ ] 三端 `vue-tsc --noEmit` 通过
- [ ] `npx prisma migrate deploy` 在干净库上可跑通
- [ ] mock 渠道可完成一笔收单 → 回调 → 对账全流程
- [ ] 开放 API 签名联调通过
- [ ] Webhook 验签联调通过（伪造回调返回 400）
- [ ] 管理后台三端可登录、审核流程可走通
- [ ] 审计哈希链可校验
- [ ] `/metrics` 可被 Prometheus 抓取
- [ ] 文档站 `docs/index.html` 可访问

---

## 7. 接手团队注意事项

1. **不要**重新加回资金池功能（余额/充值/提现/转账/红包/分账/担保），这是合规底线
2. 接新渠道时实现 `PaymentChannel` 接口即可，不要在渠道层做资金归集
3. 回调必须先验签再做幂等，金额必须 fail-closed 校验
4. 所有对外文档保持"资金绝不过平台"口径
5. 历史快照（`docs/archive/reports/`、`docs/archive/`）为改造前评审产物，仅作审计轨迹参考
