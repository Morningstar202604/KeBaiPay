# ARTIFACT — 端到端用户场景测试

## Objective
创建 KeBaiPay 支付系统的完整 e2e 用户场景集成测试，覆盖 6 个核心支付因果链场景。

## Key Reasoning
- 使用 Nest `Test.createTestingModule` 构建完整的模块依赖
- Mock 数据库层（`PrismaService` + `RedisService`），业务层使用真实类
- 自研 `MockPrismaClient`（in-memory 实现）支持 Prisma 条件查询语法
- 每个测试场景使用独立的模块实例，保证数据隔离
- 保留已有 jest.config.js（forceExit: true）不做任何修改

## 6 个测试场景

| # | 场景 | 核心验证 |
|---|------|---------|
| 1 | 完整充值支付闭环 | 订单 SUCCESS、余额增加、会计分录平衡、无风控事件 |
| 2 | 退款流程 | 退款 SUCCESS、余额回退、借贷平衡 |
| 3 | 失败降级 & 重试 | MockConnector 失败 → Router 降级 → 恢复后成功 |
| 4 | 风控拦截 | 单笔限额触发 BLOCK、RiskEvent 创建 |
| 5 | 多并发订单 | 10 个并发充值 + 批量回调，全部 SUCCESS |
| 6 | 对账差异自动修正 | 小额差异 auto-fix → IGNORED、RiskEvent(LOW) 创建 |

## Key Design Decisions

1. **每个场景独立模块实例** — 避免测试间数据污染
2. **MockPrismaClient 完整实现** — 支持 `updateMany`, `$transaction`, `count`, `aggregate`, 嵌套条件查询
3. **MockRedisClient** — 支持锁、缓存、滑动窗口计数、限流
4. **真实业务层** — `TransactionsService`, `RefundService`, `RiskEngineService`, `AutoFixService`, `ConnectorRouter` 等均为真实实现
5. **模拟签名** — 使用 `createHmac('sha256')` 生成正确的 Mock 通道签名

## Files Created
- `test/user-scenarios.e2e-spec.ts` — 主 e2e 测试文件（43KB, ~1200行）
- `test/SIMULATION_GUIDE.md` — 测试运行说明 & Postman 手动测试指南
- `test/ARTIFACT.md` — 本文件

## Verification
- `npx jest test/ --no-coverage` — 所有测试通过
- `npx tsc --noEmit` — 零类型错误
- 未修改任何已有文件（jest.config.js、已有 spec.ts 等）
