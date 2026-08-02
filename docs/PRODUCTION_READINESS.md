# 生产就绪指南：哪些功能不能直接用 & 怎么启用

> **用途**：交给部署/运维/交付人员。明确列出"现在还不能直接使用"的功能、为什么不能用、以及如何申请资质/配置使其可用。**在对外营业前，请务必先读这一篇。**
>
> 配套文档：`docs/DEPLOYMENT.md`（部署操作）、`docs/sms-integration.md`（短信接入）、`docs/MERCHANT_INTEGRATION.md`（商户对接）、`docs/API_REFERENCE.md`（接口）。

---

## 0. 一句话结论

**系统代码本身是完整、可运行的，但当前默认配置下大部分"资金出入 + 对外通知"能力处于 mock（模拟）状态，不能用于真实业务。** 要让系统真正可用，必须由企业主体去申请：**支付牌照/合规通道 → 支付渠道商户号 → 短信签名模板 →（可选）LLM/SMTP 等外部服务**，然后按本文逐一替换配置。生产环境安全校验（`src/security/security-validator.service.ts`）会强制拦截默认/弱密钥与 mock 渠道，配错了根本起不来——这是设计如此，不是 bug。

---

## 1. 功能可用性速览表

| # | 功能 | 当前状态 | 能否用于真实业务 | 启用所需 | 参考 |
|---|------|---------|:---:|----------|------|
| 1 | 充值 / 提现 / 代付（资金进出） | 默认走 mock 渠道 | ❌ 否 | 真实支付渠道（见 §2） | `src/payment-channels/` |
| 2 | 支付宝收款/代付 | 未配置 | ❌ 否 | 企业支付宝开放平台资质 + AppId + 密钥 | §2.1 |
| 3 | 微信支付收款/代付 | 未配置 | ❌ 否 | 微信支付商户号 + APIv3 证书 | §2.2 |
| 4 | 短信验证码（注册/登录/改密/绑定） | 默认 mock（只打日志） | ❌ 否 | 阿里云/腾讯云/华为云短信实名 + 签名 + 模板 | §3 |
| 5 | 邮件通知 | 未配置 SMTP 时降级为日志 | ⚠️ 部分 | SMTP 账号（企业邮箱/第三方） | §4 |
| 6 | LLM 智能体（AI 客服/风控审计） | 默认 mock（本地模板） | ⚠️ 演示级 | DeepSeek/通义/Kimi 等 API Key | §5 |
| 7 | 第三方支付工具 MCP（Stripe/PayPal） | 默认关闭 | ⚠️ 需开启 | 对应平台密钥 | §6 |
| 8 | 可观测性 OTEL/Sentry | 未配置时零开销 no-op | ✅ 可选 | OTLP Collector / Sentry DSN | §7 |
| 9 | 商户开放 API（HMAC 签名对接） | 可用 | ✅ 可用（但资金最终仍走渠道） | 商户后台自助注册 | `docs/MERCHANT_INTEGRATION.md` |
| 10 | 内部钱包/转账/红包/分账/批量代付 | 代码完整 | ✅ 内部自用可用 | 不依赖外部（除资金进出渠道） | — |

> ⚠️ **注意**：即使第 9/10 项代码可用，**凡涉及"平台收到钱 / 平台付出钱"的业务，最终都依赖真实支付渠道（第 1 项）**。没有真实渠道，整体只能作为演示/内测环境跑通流程，不能产生真实资金。

---

## 2. 支付渠道：当前只有 mock，真实业务必须接入真实渠道

### 2.1 为什么现在不能用

- `prisma/seed.ts` 只创建了 **mock 渠道**（`paymentChannelConfig` 表，`code='mock'`），用于开发环境跑通充值/代付流程。
- `src/payment-channels/payment-channel.registry.ts:43-46`：**生产环境（`NODE_ENV=production`）调用 mock 渠道直接抛 `NotFoundException`**，不会静默降级。
- 真实渠道（支付宝/微信）需要**企业资质、商户号、密钥证书**，系统代码已实现对接（`alipay.channel.ts` / `wechat-pay.channel.ts`），但默认未配置。

### 2.2 如何启用（按渠道）

**支付宝（收款 + 代付）**
1. 企业主体注册并实名认证 [支付宝开放平台](https://open.alipay.com)。
2. 创建"网页&移动应用"或"商家自运营应用"，签约你要用的产品（当面付、手机网站支付、单笔转账到支付宝账户等）。
3. 在 [蚂蚁开放平台密钥管理](https://open.alipay.com/grantvolume/manage) 生成**应用私钥**、拿到**应用公钥**与**支付宝公钥**。
4. 在管理后台「渠道管理」页配置渠道 `alipay`，填写：
   ```json
   {
     "appId": "2021002xxxxxxx",
     "privateKey": "-----BEGIN PRIVATE KEY-----...",
     "alipayPublicKey": "-----BEGIN PUBLIC KEY-----...",
     "sandbox": false
   }
   ```
5. 把渠道 `enabled=true`，设好 `priority`。生产环境 `ALIPAY_NOTIFY_URL` 必须是外网 HTTPS 可访问的回调地址。

**微信支付（收款 + 代付）**
1. 企业主体注册 [微信支付商户平台](https://pay.weixin.qq.com)。
2. 完成商户号申请、产品开通（JSAPI / Native / 转账到零钱 / 企业付款到银行卡）。
3. 获取 **商户号 `WECHAT_PAY_MCH_ID`**、**APIv3 密钥**、**商户私钥（apiclient_key.pem）**、**证书序列号**。
4. 在管理后台「渠道管理」页配置渠道 `wechat`，将上述值填入 `config` JSON。
5. `WECHAT_PAY_NOTIFY_URL` 必须外网 HTTPS 可达。

**提交结算资质时**：平台若为商户代收代付，通常需要与持牌支付机构/银行签订 **"代收付合作协议"** 或走 **四方（聚合）支付** 通道（如拉卡拉、汇付、易宝等）。此时把合作方提供的通道 SDK/参数按 `PaymentChannel` 接口实现即可（`src/payment-channels/channels/` 下新增一个渠道类并注册到 `payment-channel.registry.ts`）。

### 2.3 合规红线（务必先读）

> **在中国大陆，未经央行批准擅自从事支付业务（收单、代收代付、资金结算、沉淀资金池）属于非法经营。** 本系统天然具备支付与资金池属性。

- **对外给商户做收单/代付** → 必须持有或挂靠《支付业务许可证》。三个现实路径：
  1. **自营模式**：由持牌支付机构（银行/支付公司）作为通道方，你只做系统集成方，资金不经过你账户。
  2. **四方/聚合模式**：与持牌聚合支付服务商签约，借用其通道与结算资质。
  3. **收购/入股持牌公司**：成本高、周期长，仅适合大型项目。
- **企业内部使用（内部员工钱包、内部结算、客户积分/储值，不面向公众收单）** → 不涉及对外支付牌照，可正常使用本系统（第 10 项）。
- **拿不准**：上线前咨询专业律师/支付合规顾问。系统不构成合规意见。

---

## 3. 短信验证码：mock 不发送真实短信，必须接运营商

### 3.1 为什么现在不能用

- `src/sms/sms.service.ts` 默认 `SMS_PROVIDER=mock`，只往日志打印验证码，**不会真正发送短信**。
- `sms.service.ts:84-88`：**生产环境 `SMS_PROVIDER=mock` 直接启动失败**，强制你必须配置真实 provider。

### 3.2 如何启用

支持的厂商：**阿里云 / 腾讯云 / 华为云**。三家都需要：
1. 企业主体（或个体工商户）完成云厂商**实名认证**。
2. 申请并审核**短信签名**（如"科佰支付"，需提供营业执照等材料，审核一般 1-2 天）。
3. 申请并审核**短信模板**（如"您的验证码是${code}，10分钟内有效"，需注明用途）。

**阿里云**（`.env`）：
```bash
SMS_PROVIDER="aliyun"
SMS_SIGN_NAME="你的已审核签名"
SMS_TEMPLATE_CODE="SMS_123456789"       # 模板 CODE，模板内容需含 ${code}
SMS_ACCESS_KEY_ID="你的AK"
SMS_ACCESS_KEY_SECRET="你的SK"
```

**腾讯云**（`.env`）：
```bash
SMS_PROVIDER="tencent"
SMS_SIGN_NAME="你的签名"
SMS_TEMPLATE_CODE="模板ID（数字）"
SMS_TENCENT_SECRET_ID="..."
SMS_TENCENT_SECRET_KEY="..."
SMS_TENCENT_SDK_APP_ID="短信应用ID"
```

**华为云**（`.env`）：
```bash
SMS_PROVIDER="huawei"
SMS_SIGN_NAME="你的签名"
SMS_TEMPLATE_CODE="模板ID"
SMS_HUAWEI_APP_ID="AK"
SMS_HUAWEI_APP_SECRET="SK"
SMS_HUAWEI_SENDER="签名通道号"
```

> 注意：模板变量名必须与代码约定一致（验证码变量为 `code`）。详细步骤见 `docs/sms-integration.md`。

---

## 4. SMTP 邮件通知

- 未配置 `SMTP_USER` 时邮件通知自动降级为日志，不影响主流程。
- 启用：配置企业邮箱 SMTP 或第三方邮件服务（阿里云邮件推送等）：
  ```bash
  SMTP_HOST="smtp.example.com"
  SMTP_PORT=465            # 或 587
  SMTP_USER="noreply@your-domain.com"
  SMTP_PASS="授权码"
  SMTP_FROM="KeBaiPay <noreply@your-domain.com>"
  ```

---

## 5. LLM 智能体（AI 客服 / 风控审计）

- `LLM_PROVIDER=mock` 时使用本地模板，仅演示。
- 启用真实能力：任意 OpenAI 兼容服务均可（DeepSeek/通义/Kimi/Moonshot）：
  ```bash
  LLM_PROVIDER="deepseek"          # openai / deepseek / qwen / kimi / moonshot
  LLM_API_KEY="sk-..."
  LLM_BASE_URL="https://api.deepseek.com"
  LLM_MODEL="deepseek-chat"
  ```
- Agent 资金操作默认需要人工二次确认（`AGENT_CONFIRM_TIMEOUT_SEC`），并受 `AGENT_MAX_AMOUNT_PER_OP/DAY` 限额保护，可放心配置。

---

## 6. 第三方支付工具 MCP（Stripe / PayPal）

- 默认关闭。需要对应平台 API 密钥并开启：
  ```bash
  MCP_STRIPE_ENABLED="true"
  STRIPE_SECRET_KEY="sk_..."
  MCP_PAYPAL_ENABLED="true"
  PAYPAL_CLIENT_ID="..."
  PAYPAL_CLIENT_SECRET="..."
  ```

---

## 7. 可观测性（可选，不影响可用性）

- OTEL trace：配 `OTEL_EXPORTER_OTLP_ENDPOINT` 即启用（Jaeger/Tempo 等）。
- Sentry：配 `SENTRY_DSN` 即启用异常上报。
- Prometheus：`/metrics` 默认暴露。
- 详见 `docs/DEPLOYMENT.md` §8。

---

## 8. 部署到服务器：已知问题与"不能直接导入"的地方

### 8.1 ✅ 已修复：Docker Compose 未透传环境变量（重要）

**问题**：原 `docker-compose.yml` 的 `app` 服务只用 `environment:` 显式列出部分变量，**SMS_*、LLM_*、SMTP_*、OTEL_*、SENTRY_DSN、JWT_AGENT_SECRET、MCP_* 等全部不会进入容器**。即使你在宿主机 `.env` 配好了短信，Docker 部署下容器里也读不到 → 短信等功能永远不可用，且难以排查。

**修复**：`docker-compose.yml` 已为 `app` 服务增加 `env_file: [.env]`，将宿主机 `.env` 全部变量透传进容器；显式 `environment:`（容器间地址等）优先级更高，行为不变。**升级后部署时注意同步 `docker-compose.yml`，不要再使用旧文件。**

### 8.2 部署前必须检查清单（不检查会启动失败或功能不可用）

| 检查项 | 说明 | 不做的后果 |
|--------|------|-----------|
| 6 个 secret 全部改成强随机值 | `POSTGRES_PASSWORD` / `JWT_USER_SECRET` / `JWT_ADMIN_SECRET` / `ADMIN_DEFAULT_PASSWORD` / `ENCRYPTION_KEY` / `REDIS_PASSWORD`（≥32 位，admin 密码含大小写+数字） | 生产环境 `security-validator` 拒绝启动 |
| `NODE_ENV=production` | | 否则 Swagger 暴露、mock 可用、日志非 JSON |
| `CORS_ORIGINS` 改为真实域名 | 不能含 localhost | 前端跨域被拒 |
| `RECHARGE_NOTIFY_URL` 为外网 HTTPS | 不能 localhost | 充值回调到不了，订单永远 PENDING |
| `DATABASE_URL` / `REDIS_URL` | Docker 模式由 compose 注入；裸机手填 | 启动即失败 |
| 执行 `prisma migrate deploy` + `db:seed` | entrypoint 自动 migrate，seed 手动一次 | 表不存在 / 无管理员 |
| 真实支付渠道配置（§2） | 管理后台渠道管理 | 充值/提现代付不可用 |
| 短信 provider 非 mock（§3） | `.env` | 生产启动失败 |
| Nginx TLS + HSTS + `/metrics` 内网限制 | 见 DEPLOYMENT.md §4.7 | 明文传输/指标泄露 |
| 数据库定时备份 + Redis 密码 | crontab + `requirepass` | 数据丢失无法恢复 |

### 8.3 已知代码层面的注意点

- **Swagger 仅开发环境开启**（`src/main.ts`，`NODE_ENV !== 'production'` 才挂载）。生产环境 `GET /api/docs` 应为 404，若可见说明 NODE_ENV 配错。
- **前端 `API_BASE=''`（`public/app.js:22`）**：所有请求走相对路径，生产必须由 Nginx 将 `/` 与 `/api` 反代到同一后端，否则前端 404。
- **管理员初始密码**：seed 用 `ADMIN_DEFAULT_PASSWORD` 创建 `admin` 账号，**首次登录后必须立即改密**。
- **`.env` 请勿提交版本库**（已在 `.gitignore`）。`.env.example` 里是占位值，直接 copy 使用会被安全校验拦截（这是保护机制）。
- **没有 CI**：`.github/` 为空，交付后建议补 GitHub Actions 跑 `tsc + jest`，防止回归（可参考 `docs/DEVELOPER_GUIDE.md` 的测试命令）。

---

## 9. 交付路径建议（按业务场景选）

| 场景 | 建议 |
|------|------|
| **企业内部钱包 / 员工结算 / 积分储值（不对外收单）** | 立即可用。配置支付渠道为对公转账（银行流水人工对账）或接持牌通道代发即可。 |
| **给商户做聚合收款 / 代收代付** | 必须先与持牌支付机构（银行、支付公司、聚合服务商）签约，拿到真实通道参数后接入 §2；上线前过合规审查。 |
| **只想先做产品演示 / 联调** | 保持 mock + `NODE_ENV=development`，跑通全流程后再逐项替换真实渠道。 |

---

*最后更新：由部署审查生成。发现问题请回填本文档对应章节，保持"生产就绪清单"始终可用。*
