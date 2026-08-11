# Agent 智能体测试报告

> 对 KeBaiPay AI 智能体层做的一次完整功能测试 + 排错修复 + 常见智能体坑审计。
> 覆盖：认证/授权、会话、多轮对话、工具调用、人工确认、哈希链审计、LLM 接入。

---

## 一、测试环境与结论

| 项 | 说明 |
|---|---|
| 运行方式 | 本地 `NODE_ENV=development` + `LLM_PROVIDER=mock` + 演示数据 |
| 结论 | **Agent 功能经修复后已可通过 HTTP 完整使用**（此前存在阻断性缺陷，见 §二） |
| 外部 LLM | 提供的 `zhiyunapi.cc` key 经多种认证方式验证均为 `Invalid token`，**无法做真实多模型调用**（见 §四） |

---

## 二、发现并修复的缺陷（含根因）

### 缺陷 1（阻断）｜用户无法通过 HTTP 使用 Agent
- **现象**：`POST /agent/login` 404；整个 `AgentController` 被 `AgentAuthGuard`（需要 Agent token）保护，而换取 token 的 `login`/`authorize` 也在此控制器内 → **"没有 token 无法换取 token"的循环**，Agent 对外完全不可用。
- **根因**：`agent-auth.service.login` 从未暴露为 HTTP 路由；且认证管理端点被错误的守卫（Agent token 而非用户 token）保护。
- **修复**：
  - 新增 `AgentAuthController`（用户 JWT，`AgentUserAuthGuard`）：`login / authorize / revoke / authorizations`；`login`/`authorize` 的 `subjectId` 强制绑定为当前登录用户，**杜绝越权指定他人主体**。
  - 新增 `AgentAdminController`（管理员 JWT，`AgentAdminAuthGuard`）：`POST/GET /agent/admin/agents`（创建/列出 Agent）。
  - 原 `AgentController` 收敛为运行时端点（会话/chat/confirm/verify-chain）。
- 涉及：`agent-auth.controller.ts`、`agent.controller.ts`、`agent-user-auth.guard.ts`、`agent-admin-auth.guard.ts`、`agent.module.ts`、`agent.dto.ts`、`agent-auth.service.ts`。

### 缺陷 2（阻断）｜授权表字段映射错误
- **现象**：`POST /agent/authorize` 报 `Prisma P2022: column "subjectType" does not exist`。
- **根因**：`AgentAuthorization.subjectType` 字段**缺少 `@map("subject_type")`**，Prisma 按字段名（camelCase `subjectType`）查列，而迁移建的是 `subject_type` → 字段/列映射不一致。
- **修复**：schema 补 `@map("subject_type")`，生成并应用迁移 `20260811010514_fix_agent_auth_subject_type`（该迁移同时把 schema 与迁移历史里**既有的 drift** 一并对齐）。
- 涉及：`prisma/schema.prisma`、新迁移。

### 缺陷 3（阻断）｜人工确认流程工具查不到
- **现象**：对 `kbpay_transfer`（requireConfirm）执行 CONFIRM 时报"工具不存在"。
- **根因**：`confirmOp` 用 `opLog.scope.split(':')[0]` 当场景去 `getTools()`，而 `scope` 存的是工具名（`kbpay_transfer`），`getTools` 只认 `wallet/merchant/risk/support` → 返回空数组。
- **修复**：待确认日志 `detail` 里记录真实 `scenario`，`confirmOp` 从 `detail.scenario` 恢复工具集。
- 涉及：`agent.service.ts`。

### 缺陷 4（一致性）｜工具调用上下文未跨轮持久化
- **现象**：`sendMessage` 传给 LLM 的历史只保留 `role+content`，**丢弃 assistant 的 toolCalls 与工具结果**。
- **影响**：单轮内 Vercel SDK 的 `maxSteps` 循环可用；跨轮（多轮对话）时 LLM 看不到结构化工具结果，只能依赖回复文本。属能力退化而非崩溃。
- **建议（未实施，列为技术债）**：把 `tool` 角色消息与工具结果写入 `agent_message` 历史，供跨轮引用。

---

## 三、多轮 + 复杂场景测试（mock 模式）

已验证全链路：**管理员建 Agent → 用户授权 → 用户登录换 Agent token → 创建会话 → 多轮对话 → 确认操作 → 哈希链校验**。

| 场景 | 结果 |
|---|---|
| 管理端创建 Agent（wallet/merchant/risk） | ✅ |
| 用户授权（subjectId 绑定登录用户） | ✅ |
| 用户换取 Agent token | ✅ |
| 创建/列出/关闭会话 | ✅ |
| 多轮对话（第 1 轮查余额、第 2 轮查账单…） | ✅（mock 模板按关键词路由） |
| 资金类操作人工确认（CONFIRM 执行工具、REJECT 拒绝） | ✅（修复后不报"工具不存在"） |
| 操作哈希链校验（verify-chain） | ✅ |
| 查询授权列表 / 撤销授权 | ✅ |

---

## 四、外部 LLM（多模型）测试状态

- 提供：`key=sk-VasE...`、`url=https://zhiyunapi.cc`。
- 验证：对 `/v1/models` 与 `/v1/chat/completions` 以 **Bearer / 裸 token / query / api-key 头** 共 4 种方式请求，均返回 `new_api_error: Invalid token`。
- **结论**：该 key 在当前端点无效（非格式问题），**无法进行真实多模型调用**。系统支持通过 `LLM_PROVIDER + LLM_MODEL + LLM_BASE_URL + LLM_API_KEY` 切换任意 OpenAI 兼容模型；拿到有效 key 后，按 `docs/EXTERNAL_QUICKSTART.md` §2.3 配置即可（即"最后一步"）。
- 真实 LLM 联调待有效 key 后执行：多模型（如 deepseek-chat / qwen / gpt 系）各跑一轮含工具调用的对话，验证 tool-calling 与 confirm 全链路。

---

## 五、常见智能体搭建错误/问题审计

| 检查项 | 状态 | 说明 |
|---|---|---|
| 工具调用步数上限（防死循环） | ✅ | `maxSteps=10`、`MAX_TURNS=20` |
| 金额/参数校验 | ✅ | `validateAmountYuan`（≥0.01、≤50万）、`truncate` 限长 |
| 越权/IDOR | ✅ | 商户对账工具按 `merchantId` 过滤；`subjectId` 绑定登录用户；`checkScope` 鉴权 |
| 提示词注入防护 | ✅/⚠️ | system prompt 有"忽略既往指令/切换管理员"等拒绝规则；scoped 工具 + 人工确认兜底；未做输入过滤（依赖工具与确认层） |
| 敏感信息泄露 | ✅ | system prompt 禁止输出密钥/卡号；工具结果不返回敏感字段 |
| 资金操作人工确认 | ✅（逻辑） | `requireConfirm=true` → PENDING_CONFIRM → 用户确认才执行；**但见 §六：转账工具为 stub** |
| 审计链防篡改 | ✅ | 链式 hash + PG 咨询锁串行写入；`verify-chain` 校验 |
| 超时兜底 | ✅ | LLM 调用 `AbortSignal.timeout`；失败降级 mock |
| 多轮上下文持久化 | ⚠️ | 见缺陷 4（技术债） |
| Agent 无可用（缺注册入口） | ✅ 已修复 | 新增管理端创建 Agent + 用户授权/登录入口 |

---

## 六、已知限制（如实说明）

1. **转账工具 `kbpay_transfer` 为 stub**：`execute` 仅做校验并返回"待确认"，**并未真正完成资金划转**（真实转账需接入 `TransferService` 并设计"授权 Agent 免支付密码"的资金安全策略）。当前不会移动资金，也不会造成资金损失；线上开启前需补齐该实现。
2. **mock 模式不产生真实工具调用**：`LLM_PROVIDER=mock` 只返回模板文本，不会触发工具，因此工具/确认链路的端到端需用真实 LLM 复验。
3. **外部 LLM key 当前无效**（§四）。
4. **工具结果未跨轮持久化**（缺陷 4，技术债）。

---

## 七、如何复现测试

```bash
# 1. 管理端创建 Agent（admin token）
POST /agent/admin/agents   { name, scenario:"wallet", scopes:[...] }
# 2. 用户授权（user token，subject 绑定登录用户）
POST /agent/authorize      { agentId, scopes:[...] }
# 3. 用户换 Agent token
POST /agent/login          { agentId, authId }
# 4. 对话 / 确认 / 校验
POST /agent/conversations / POST /agent/chat / POST /agent/confirm / GET /agent/verify-chain/:agentId
```

> 详细接口见 `docs/API_REFERENCE.md`。完整 e2e：`test/agent.e2e-spec.ts`（32 用例）。
