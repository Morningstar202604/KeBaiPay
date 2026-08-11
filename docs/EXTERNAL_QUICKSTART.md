# 接入外部服务：只需最后一步

> **目标**：所有外部接入（短信、邮件、LLM、可观测性、支付渠道）都已内置对接代码与配置读取，
> 你**唯一要做的事就是把缺失的配置填进 `.env`（或管理后台），然后重启**。
> 本文把"最后一步"讲清楚。

---

## 0. 一句话

先跑一条命令，它会告诉你每个外部服务还差什么、该填什么：

```bash
npm run check:external
```

输出里标 **✗** 的就是"最后一步"要补的项。补完 `.env` → 重启服务即可。

---

## 1. 步骤总览（从零到接入）

| 步骤 | 做什么 | 耗时 |
|------|--------|------|
| 1 | 准备外部账号/资质（短信签名、邮件账号、LLM Key、支付资质等） | 按平台审核时长 |
| 2 | 运行 `npm run check:external`，看缺什么 | 1 分钟 |
| 3 | 把 ✗ 项填进 `.env`（或管理后台配置支付渠道） | 5 分钟 |
| 4 | 重启服务（`NODE_ENV=production` 时安全校验会自动放行已配置项） | 1 分钟 |
| 5 | 再次 `npm run check:external`，应全部 ✓ | 1 分钟 |

> 完成第 3 步的那一刻，就是"最后一步"本身。

---

## 2. 各外部服务——最后一步只需要填什么

### 2.1 短信（手机号验证码）

申请好**签名 + 模板**后，把 `.env` 里这些值填上即可（任选一家）：

```bash
# 阿里云
SMS_PROVIDER=aliyun
SMS_SIGN_NAME="你的已审核签名"
SMS_TEMPLATE_CODE="SMS_123456789"
SMS_ACCESS_KEY_ID="AK..."
SMS_ACCESS_KEY_SECRET="SK..."
```
```bash
# 腾讯云
SMS_PROVIDER=tencent
SMS_SIGN_NAME="你的签名"
SMS_TEMPLATE_CODE="模板ID"
SMS_TENCENT_SECRET_ID="..."
SMS_TENCENT_SECRET_KEY="..."
SMS_TENCENT_SDK_APP_ID="短信应用ID"
```
```bash
# 华为云
SMS_PROVIDER=huawei
SMS_SIGN_NAME="你的签名"
SMS_TEMPLATE_CODE="模板ID"
SMS_HUAWEI_APP_ID="AK"
SMS_HUAWEI_APP_SECRET="SK"
SMS_HUAWEI_SENDER="签名通道号"
```

> 模板变量名必须是 `code`（代码约定）。详细：`docs/sms-integration.md`。

### 2.2 邮件

```bash
SMTP_HOST="smtp.your-domain.com"
SMTP_PORT=465
SMTP_USER="noreply@your-domain.com"
SMTP_PASS="授权码"
SMTP_FROM="KeBaiPay <noreply@your-domain.com>"
```

### 2.3 LLM 智能体（AI 客服 / 风控审计）

任意 OpenAI 兼容服务，填 Key 即可：

```bash
LLM_PROVIDER="deepseek"   # openai / deepseek / qwen / kimi / moonshot
LLM_API_KEY="sk-..."
LLM_BASE_URL="https://api.deepseek.com"
LLM_MODEL="deepseek-chat"
```

### 2.4 可观测性（可选）

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="http://jaeger:4318"   # 链路追踪，不填则 no-op
SENTRY_DSN="https://xxx@sentry.io/1"               # 异常上报，不填则不启用
```

### 2.5 支付渠道（支付宝 / 微信）

支付渠道**在管理后台「渠道管理」页面配置**（存于数据库，不走 `.env`）：

1. 登录管理后台 → 渠道管理。
2. 新增/编辑渠道 `alipay` 或 `wechat`，填入密钥 JSON（见 `docs/PRODUCTION_READINESS.md` §2）。
3. 保存后 `enabled=true`，`priority` 设好。
4. `NODE_ENV=production` 时，mock 渠道会被安全校验拒绝，务必换成真实渠道。

---

## 3. 如何确认接入成功

| 服务 | 验证方式 |
|------|---------|
| 短信 | `npm run check:external` 短信项为 ✓；触发一次注册/改密，手机收到验证码 |
| 邮件 | 触发一次通知（如提现审核），收件箱收到邮件 |
| LLM | `curl -X POST /agent/chat` 传 message，看返回是否为真实模型回复（非模板） |
| 支付渠道 | 管理后台渠道管理显示渠道可用；发起一笔小额充值走真实渠道 |
| 全量 | `npm run check:external` 全部 ✓ + `NODE_ENV=production` 启动成功 |

---

## 4. 常见问题

- **为什么配置了短信还发不出去？** 检查 `SMS_SIGN_NAME` 是否为已审核签名、`SMS_TEMPLATE_CODE` 是否含 `${code}` 变量、AK/SK 权限是否开通短信服务。
- **生产启动失败提示密钥过弱？** 这是安全校验（`security-validator`）在保护你，把 `JWT_*_SECRET` / `ENCRYPTION_KEY` 改成 ≥32 位随机值即可。
- **回调收不到？** `RECHARGE_NOTIFY_URL` / `ALIPAY_NOTIFY_URL` / `WECHAT_PAY_NOTIFY_URL` 必须是公网 HTTPS 可达地址，不能是 localhost。
- **支付渠道管理里没有真实渠道？** 需先按 `docs/PRODUCTION_READINESS.md` §2 申请资质并新增渠道；代码已内置对接实现。

---

*配套：`docs/PRODUCTION_READINESS.md`（外部依赖总清单 + 资质申请）、`docs/sms-integration.md`（短信详细）、`docs/DEPLOYMENT.md`（部署）。*
