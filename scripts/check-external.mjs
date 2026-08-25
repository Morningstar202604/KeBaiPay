#!/usr/bin/env node
/**
 * KeBaiPay 外部服务就绪自检
 * ------------------------
 * 运行：npm run check:external
 *
 * 用途：接入外部服务（短信/邮件/LLM/可观测性）前，先跑本脚本，
 * 它会扫描 .env，逐项告诉你每个外部服务当前状态与"还差哪些配置"。
 * 你只需把标为 ✗ 的项补进 .env，然后重启服务即可 —— 这就是"最后一步"。
 *
 * 说明：
 * - 支付渠道（支付宝/微信）在管理后台「渠道管理」配置（存于数据库），
 *   本脚本无法读库，请在管理后台检查，见输出末尾提示。
 * - 本脚本不连接任何外部服务，只做配置存在性/格式检查，安全无副作用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// ---- 读取 .env ----
function loadEnv() {
  const env = {}
  const p = path.join(root, '.env')
  if (!fs.existsSync(p)) return env
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    let k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[k] = v
  }
  return env
}
const E = loadEnv()

const OK = '✓'
const MISS = '✗'
const WARN = '⚠'

const rows = []
function add(icon, label, detail) {
  rows.push({ icon, label, detail })
}

// ---- ① 短信 SMS ----
const smsProvider = (E.SMS_PROVIDER || 'mock').toLowerCase()
if (smsProvider === 'mock') {
  add(MISS, '短信 SMS（手机号验证）', '当前 mock，不发送真实短信；生产环境 mock 会拒绝启动。')
  add('', '  · 待填', 'SMS_PROVIDER=aliyun|tencent|huawei\n        SMS_SIGN_NAME=已审核签名\n        SMS_TEMPLATE_CODE=模板CODE')
} else {
  const need = {
    aliyun: ['SMS_SIGN_NAME', 'SMS_TEMPLATE_CODE', 'SMS_ACCESS_KEY_ID', 'SMS_ACCESS_KEY_SECRET'],
    tencent: ['SMS_SIGN_NAME', 'SMS_TEMPLATE_CODE', 'SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDK_APP_ID'],
    huawei: ['SMS_SIGN_NAME', 'SMS_TEMPLATE_CODE', 'SMS_HUAWEI_APP_ID', 'SMS_HUAWEI_APP_SECRET', 'SMS_HUAWEI_SENDER'],
  }[smsProvider]
  const missing = (need || []).filter((k) => !E[k])
  if (missing.length === 0) add(OK, '短信 SMS', `provider=${smsProvider}，凭据齐全`)
  else add(MISS, '短信 SMS', `provider=${smsProvider}，缺少：${missing.join(', ')}`)
}
rows.at(-1).detail += '\n        详细：docs/sms-integration.md'

// ---- ② SMTP 邮件 ----
if (E.SMTP_USER) {
  add(OK, 'SMTP 邮件', `已配置 ${E.SMTP_HOST || '?'} (${E.SMTP_USER})`)
} else {
  add(MISS, 'SMTP 邮件', '未配置；邮件通知将降级为日志（不影响主流程）。')
  add('', '  · 待填', 'SMTP_HOST=smtp.example.com\n        SMTP_PORT=465\n        SMTP_USER=账号\n        SMTP_PASS=授权码\n        SMTP_FROM=发件人')
}

// ---- ③ LLM 智能体 ----
const llmProvider = (E.LLM_PROVIDER || 'mock').toLowerCase()
if (llmProvider === 'mock') {
  add(WARN, 'LLM 智能体（AI客服/风控）', '当前 mock（本地模板，演示级）；配置真实 Key 后可用。')
  add('', '  · 待填', 'LLM_PROVIDER=deepseek|openai|qwen|kimi|moonshot\n        LLM_API_KEY=sk-...\n        LLM_BASE_URL=https://api.deepseek.com\n        LLM_MODEL=deepseek-chat')
} else if (!E.LLM_API_KEY) {
  add(MISS, 'LLM 智能体', `provider=${llmProvider}，缺少 LLM_API_KEY`)
} else {
  add(OK, 'LLM 智能体', `provider=${llmProvider}，API Key 已配置`)
}

// ---- ④ 可观测性（可选）----
if (E.OTEL_EXPORTER_OTLP_ENDPOINT) add(OK, 'OTEL 链路追踪', E.OTEL_EXPORTER_OTLP_ENDPOINT)
else add(WARN, 'OTEL 链路追踪', '未配置（no-op，不影响可用性）')

// ---- ⑤ 运行环境/密钥强度 ----
const secrets = {
  JWT_USER_SECRET: 32, JWT_ADMIN_SECRET: 32, JWT_AGENT_SECRET: 32, ENCRYPTION_KEY: 32,
}
for (const [k, min] of Object.entries(secrets)) {
  if (!E[k]) add(MISS, `密钥 ${k}`, '未配置')
  else if (E[k].length < min) add(MISS, `密钥 ${k}`, `仅 ${E[k].length} 位，应 ≥${min} 位（生产）`)
}
if (E.NODE_ENV === 'production') {
  if (E.CORS_ORIGINS && E.CORS_ORIGINS.includes('localhost')) {
    add(MISS, 'CORS_ORIGINS', '生产环境不能包含 localhost')
  }
  if (E.RECHARGE_NOTIFY_URL && E.RECHARGE_NOTIFY_URL.startsWith('http://localhost')) {
    add(MISS, 'RECHARGE_NOTIFY_URL', '生产环境必须是外网 HTTPS 回调地址')
  }
}

// ---- 输出 ----
console.log('\n=== KeBaiPay 外部服务就绪自检 ===\n')
for (const r of rows) {
  if (r.icon) console.log(` ${r.icon}  ${r.label}`)
  else console.log(`     ${r.label}`)
  if (r.detail) {
    for (const line of r.detail.split('\n')) console.log(`       ${line}`)
  }
  console.log('')
}

const bad = rows.filter((r) => r.icon === MISS).length
const warn = rows.filter((r) => r.icon === WARN).length
console.log(`--- 汇总：${OK}${rows.filter((r) => r.icon === OK).length} 就绪 · ${MISS}${bad} 待补 · ${WARN}${warn} 可选 ---`)
console.log('')
if (bad > 0) {
  console.log('◆ 最后一步：把上方 ✗ 项补进 .env → 重启服务 即可接入。')
}
console.log('◆ 支付渠道（支付宝/微信）在「管理后台 → 渠道管理」配置（存库），请登录后台检查。')
console.log('◆ 完整清单与资质准备：docs/PRODUCTION_READINESS.md 的「外部依赖总清单」。')
console.log('◆ 分步指引：docs/EXTERNAL_QUICKSTART.md\n')
