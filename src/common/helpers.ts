import { customAlphabet } from 'nanoid'
import { lookup as dnsLookup, type LookupAddress } from 'dns'
import { isIPv4, isIPv6 } from 'net'
import { request as httpRequest, type RequestOptions } from 'http'
import { request as httpsRequest } from 'https'
import { Direction } from './enums'

// ---------------------------------------------------------------------------
// HTML 转义（全站唯一实现；notifications/messages 等邮件/消息 HTML 插值统一引用）
// ---------------------------------------------------------------------------

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}
const HTML_ESCAPE_REGEX = /[&<>"']/g

/**
 * HTML 实体转义：邮件/站内信 HTML 中插入用户可控变量前必须转义，
 * 防止订单号、商品名、LLM 输出等字段注入 <script> 或逃逸属性结构。
 * 仅转义 OWASP 推荐的 5 个字符即可覆盖所有 HTML 注入向量。
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPE_MAP[ch])
}

// ---------------------------------------------------------------------------
// 复式记账：冻结腿对手方分录
// ---------------------------------------------------------------------------

/** accountLedger.create 的最小结构类型（兼容 Prisma.TransactionClient / PrismaService） */
interface LedgerWriter {
  accountLedger: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
  }
}

export interface FrozenLegEntryParams {
  accountId: string
  transactionId: string
  type: string
  amount: number
  /** 冻结余额变动前值 */
  frozenBefore: number
  /** 冻结余额变动后值 */
  frozenAfter: number
  remark: string
}

/**
 * 写入"冻结腿"对手方账本分录（复式记账的另一半）。
 *
 * 背景：availableBalance ↔ frozenBalance 的内部划转若只记单边，
 * 平台账本净额会漂移，日终对账 ledger_balance 必然 FAILED。
 * 本助手按冻结余额增减自动推导方向：
 *   冻结增加 → DEBIT（与 available 侧的 CREDIT 配对）
 *   冻结减少 → CREDIT（与 available 侧的 DEBIT 配对）
 */
export async function createFrozenLegLedgerEntry(
  tx: LedgerWriter,
  p: FrozenLegEntryParams,
): Promise<void> {
  await tx.accountLedger.create({
    data: {
      accountId: p.accountId,
      transactionId: p.transactionId,
      type: p.type,
      amount: p.amount,
      balanceBefore: p.frozenBefore,
      balanceAfter: p.frozenAfter,
      direction:
        p.frozenAfter > p.frozenBefore ? Direction.DEBIT : Direction.CREDIT,
      remark: p.remark,
    },
  })
}

export function yuanToFen(yuan: number): number {
  if (yuan < 0 || !Number.isFinite(yuan)) {
    throw new Error('金额必须为非负有限数字')
  }
  if (yuan > 1e9) {
    throw new Error('金额超出上限')
  }
  // 四舍五入到分：消除 IEEE 754 表示误差（如 0.1+0.2 = 0.30000000000000004）
  const fen = Math.round(yuan * 100)
  // 拒绝真实的超两位小数输入（如 10.123、0.005）：
  // 还原回元后与原值偏差超过 1e-9，说明有第三位及以后的小数被丢弃，
  // 此前用 toFixed(2) 会静默截断造成金额偏差
  if (Math.abs(fen / 100 - yuan) > 1e-9) {
    throw new Error('金额最多支持两位小数')
  }
  return fen
}

export function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2)
}

const HEX = '0123456789abcdef'
const HEX_UPPER = '0123456789ABCDEF'
const idHex = customAlphabet(HEX, 16)
const idHexUpper = customAlphabet(HEX_UPPER, 8)
const idSecret = customAlphabet(HEX, 32)

export function generateOrderNo(prefix: string): string {
  const now = Date.now().toString(36).toUpperCase()
  return `${prefix}${now}${idHexUpper()}`
}

export function generatePaymentNo(): string {
  return `P${Date.now()}${idHexUpper()}`
}

export function generateQrCode(): string {
  const now = Date.now().toString(36).toUpperCase()
  return `KB-${now}${idHexUpper()}`
}

export function generateMerchantNo(): string {
  return `M${Date.now()}${idHexUpper()}`
}

export function generateAppId(): string {
  return `app_${idHex()}`
}

export function generateAppSecret(): string {
  return idSecret()
}

/**
 * 安全解析 JSON 字符串：解析失败时返回 fallback 默认值，
 * 避免恶意/损坏的 JSON 在业务关键路径上抛出未捕获异常。
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * 校验回调 URL 是否安全（防 SSRF，含 DNS rebinding 防护）
 *
 * 拦截：非 http/https 协议、hostname 为内网字面量、以及 DNS 解析出的
 * 任一 A/AAAA 记录命中内网/保留/回环段。
 *
 * 异步：需调用 dns.lookup 解析 hostname 的全部 IP 后逐条判断，
 * 避免 attacker.com 先解析公网 IP 通过校验、再 rebinding 到内网。
 */
export async function isCallbackUrlSafe(
  url: string,
): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { safe: false, reason: 'CALLBACK_URL_FORMAT_INVALID' }
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { safe: false, reason: 'CALLBACK_URL_PROTOCOL_INVALID' }
  }
  const hostname = parsed.hostname

  // 直接拦截明显的内网/回环字面量
  if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1') {
    return { safe: false, reason: 'CALLBACK_URL_INTERNAL' }
  }
  // 拦截十进制/八进制/十六进制 IP 字面量
  if (/^\d+$/.test(hostname) || hostname.startsWith('0x') || /^0\d+\./.test(hostname)) {
    return { safe: false, reason: 'CALLBACK_URL_INTERNAL' }
  }

  // DNS 解析所有 A/AAAA 记录，逐条判断是否为内网/保留/回环地址
  let addresses: LookupAddress[]
  try {
    addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      dnsLookup(hostname, { all: true }, (err, addrs) => {
        if (err) reject(err)
        else resolve(addrs ?? [])
      })
    })
  } catch {
    return { safe: false, reason: 'CALLBACK_URL_FORMAT_INVALID' }
  }
  if (addresses.length === 0) {
    return { safe: false, reason: 'CALLBACK_URL_FORMAT_INVALID' }
  }
  for (const addr of addresses) {
    if (isInternalIp(addr.address)) {
      return { safe: false, reason: 'CALLBACK_URL_INTERNAL' }
    }
  }
  return { safe: true }
}

/**
 * 判断 IP 是否为内网/保留/回环地址
 * 仅识别 IPv4 与 IPv6，未知格式按不安全处理。
 */
function isInternalIp(ip: string): boolean {
  if (isIPv4(ip)) return isInternalIPv4(ip)
  if (isIPv6(ip)) return isInternalIPv6(ip)
  return true
}

function isInternalIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  return false
}

function isInternalIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // ::1 回环（含完整展开形式）
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
  // IPv4-mapped IPv6：::ffff:a.b.c.d 或 ::ffff:xxxx:xxxx，按内嵌 IPv4 判断
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice('::ffff:'.length)
    if (rest.includes('.')) {
      if (isInternalIPv4(rest)) return true
    } else {
      const groups = rest.split(':')
      if (groups.length === 2) {
        const hi = parseInt(groups[0], 16)
        const lo = parseInt(groups[1], 16)
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
          if (isInternalIPv4(ipv4)) return true
        }
      }
    }
  }
  // 取首个 hextet 判断 ULA / link-local
  const first = firstHextet(lower)
  if (first !== null) {
    if (first >= 0xfc00 && first <= 0xfdff) return true // fc00::/7（唯一本地地址）
    if (first >= 0xfe80 && first <= 0xfebf) return true // fe80::/10（链路本地）
  }
  return false
}

// 取 IPv6 地址的首个 hextet 数值；以 '::' 开头表示前导零压缩，首 hextet 视为 0
function firstHextet(ip: string): number | null {
  if (ip.startsWith('::')) return 0
  const head = ip.split(':')[0]
  if (head === '' || head.includes('.')) return null
  const n = parseInt(head, 16)
  return Number.isNaN(n) ? null : n
}

/**
 * SSRF 加固的 POST JSON 请求（用于商户回调通知）
 *
 * 防护点：
 * 1. 请求前再次校验 URL 安全性（内网字面量/DNS 记录）；
 * 2. 自行解析 DNS 并固定 IP 直连（Host 头保留原域名、HTTPS servername=SNI 校验原域名），
 *    消除"预检通过 → fetch 再次独立解析 → DNS rebinding 指向内网"的 TOCTOU 窗口；
 * 3. 不跟随重定向（3xx 一律视为失败），防止重定向绕过。
 */
export async function postJsonPinned(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number }> {
  // 双保险：调用方通常已校验过，此处独立再校验一次
  const safety = await isCallbackUrlSafe(url)
  if (!safety.safe) {
    throw new Error(`CALLBACK_URL_UNSAFE:${safety.reason}`)
  }

  const parsed = new URL(url)
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    dnsLookup(parsed.hostname, { all: true }, (err, addrs) => {
      if (err) reject(err)
      else resolve(addrs ?? [])
    })
  })
  const target = addresses.find((a) => !isInternalIp(a.address))
  if (!target) {
    throw new Error('CALLBACK_URL_UNSAFE:NO_PUBLIC_IP')
  }

  const isHttps = parsed.protocol === 'https:'
  const requestFn = isHttps ? httpsRequest : httpRequest
  const options: RequestOptions = {
    protocol: parsed.protocol,
    host: target.address,
    port: parsed.port || (isHttps ? 443 : 80),
    path: `${parsed.pathname}${parsed.search}`,
    method: 'POST',
    headers: {
      ...headers,
      Host: parsed.host,
    },
    // TLS 证书/SNI 校验仍按原域名进行，防证书伪造
    ...(isHttps ? { servername: parsed.hostname } : {}),
    timeout: timeoutMs,
  }

  return new Promise((resolve, reject) => {
    const req = requestFn(options, (res) => {
      // 不跟随重定向：3xx 视为回调失败
      const status = res.statusCode || 0
      res.resume()
      res.on('end', () => resolve({ ok: status >= 200 && status < 300, status }))
      res.on('error', reject)
    })
    req.on('timeout', () => {
      req.destroy(new Error('CALLBACK_TIMEOUT'))
    })
    req.on('error', reject)
    req.end(body)
  })
}
