# 配置参考（Configuration Reference）

> 全部环境变量集中在根目录 `.env`（模板见 [`.env.example`](../.env.example)）。
> 部署形态差异见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。生产环境由 `SecurityValidatorService`
> 强校验弱密钥/默认值，未通过将拒绝启动。

## 快速对照表

| 分类 | 变量 | 必填 | 说明 |
|---|---|---|---|
| **密钥类（生产必改）** | `POSTGRES_PASSWORD` | ✅ | 数据库密码，compose 注入 |
| | `JWT_USER_SECRET` / `JWT_ADMIN_SECRET` / `JWT_AGENT_SECRET` | ✅ | 三套独立 JWT 密钥，≥32 字符，必须互不相同 |
| | `ENCRYPTION_KEY` | ✅ | AES-256-GCM 主密钥 ≥32 字符；用于身份证/银行卡/渠道凭据加密。**泄露=全量数据暴露，务必妥善保管** |
| | `ADMIN_DEFAULT_PASSWORD` | ✅ | seed 初始管理员密码，首次登录后修改 |
| | `MOCK_CHANNEL_SECRET` | dev | mock 渠道签名密钥（生产禁 mock） |
| **数据库** | `DATABASE_URL` | ✅ | `postgresql://user:pass@host:5432/db?schema=public` |
| | `DATABASE_CONNECTION_LIMIT` | – | 单进程连接池上限（默认 5，多副本按 PG max_connections 折算） |
| | `DATABASE_STATEMENT_TIMEOUT_MS` / `DATABASE_POOL_TIMEOUT_SEC` | – | SQL/取连接超时（默认 30s/10s） |
| **Redis** | `REDIS_URL` | ✅* | `redis://[:password@]host:6379`；资金操作依赖分布式锁，生产必须可用（fail-closed） |
| | `REDIS_PASSWORD` | 生产 | compose 模式注入 |
| **服务** | `PORT` | – | 默认 3001 |
| | `NODE_ENV` | – | `production` 时启用全部安全强校验 |
| | `CORS_ORIGINS` | 生产 | 逗号分隔白名单（前端三端 dev 端口 5173-5175） |
| **支付回调** | `RECHARGE_NOTIFY_URL` | ✅ | 充值回调完整外网 URL，缺省时充值下单直接报错 |
| | `CASHIER_BASE_URL` | – | 收银台对外地址（回跳商户页） |
| | `SMS_PROVIDER` | – | `mock`(dev) / `aliyun` / `tencent` / `huawei`，接入见 [sms-integration](sms-integration.md) |
| **通知** | `SMTP_HOST/PORT/USER/PASS/FROM` | – | 未配置 SMTP_USER 时邮件自动降级为日志 |
| **可观测** | `OTEL_EXPORTER_OTLP_ENDPOINT` | – | OTLP HTTP 导出；未配置零开销 no-op |
| | `METRICS_TOKEN` | 建议 | 配置后 `/metrics` 要求 Bearer 认证 |
| **AI 智能体** | `LLM_PROVIDER` | – | `mock`/`openai`/`deepseek`/`qwen`…（mock 仅返回本地模板） |
| | `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 真实 AI 时 | OpenAI 兼容协议即可直连 DeepSeek/通义/Kimi |
| | `LLM_TIMEOUT_MS` / `LLM_MAX_TOKENS` / `LLM_TEMPERATURE` | – | 默认 30s / 2000 / 0.3 |
| | `JWT_AGENT_EXPIRES_IN` | – | Agent token 有效期（默认 7d） |
| | `AGENT_MAX_AMOUNT_PER_OP` / `_PER_DAY` | – | AI 代操作单笔/单日限额（分），默认 50000/200000 |
| | `AGENT_CONFIRM_TIMEOUT_SEC` | – | 人工确认超时（默认 60s 自动过期） |
| | `KBPAY_MCP_USER_ID` | MCP 时 | 独立/嵌入式 MCP 的绑定身份；不配置则 userId 类工具 fail-closed 拒绝 |
| **沙箱体验** | `SANDBOX_AUTO_APPROVE` | – | `true` 且非生产：实名/入驻提交即过（演示用）；生产强制忽略 |

## 配置原则

1. **密钥分层**：JWT 三密钥独立轮换互不影响；`ENCRYPTION_KEY` 一旦投入使用不可更换
   （轮换需全量重加密，规划期就要放保险柜）。
2. **fail-closed 优先**：Redis 不可用时资金操作直接拒绝而非降级放行；
   生产环境 mock 渠道/弱密钥一律拒绝启动。
3. **渠道凭据不入 env**：微信/支付宝等凭据由管理后台「渠道配置中心」录入，
   AES-256-GCM 加密落库（`enc:v1:` 前缀），保存后热同步到连接器运行时。
4. **改动生效方式**：env 改动需重启进程；渠道配置为热同步无需重启。

## 相关文档

- 部署步骤与 Docker Compose 编排 → [`DEPLOYMENT.md`](DEPLOYMENT.md)
- 上线前检查清单 → [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md)
- 版本与发版纪律 → [`VERSIONING.md`](VERSIONING.md)
