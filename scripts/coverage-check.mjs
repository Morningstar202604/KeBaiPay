import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const openapi = await (await fetch('http://localhost:3000/api/docs-json')).json()

const backend = new Map()
for (const [p, methods] of Object.entries(openapi.paths || {})) {
  for (const [m] of Object.entries(methods)) {
    if (m === 'parameters') continue
    const np = p.replace(/\{[^}]+\}/g, '{p}')
    backend.set(`${m.toUpperCase()} ${np}`, true)
  }
}

function read(file) {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8')
  } catch {
    return ''
  }
}

const appjs = read('public/app.js')
const sdk = read('public/sdk/kebaipay.js')

const re = /(api|adminApi|fetch)\(\s*([`'\x22])([^`'\x22]+)\2\s*(?:,\s*\{([\s\S]{0,1200}?)\})?/g

const calls = []
for (const code of [appjs, sdk]) {
  let m
  while ((m = re.exec(code))) {
    const fn = m[1]
    let url = m[3]
    const opts = m[4] || ''
    let method = 'GET'
    const mm = /method:\s*['\x22`]([A-Z]+)['\x22`]/.exec(opts)
    if (mm) method = mm[1]
    calls.push({ fn, url, method })
  }
}

// 处理带 ${...} 的动态路径与 query
function normalize(url) {
  const pathOnly = url.split('?')[0]
  return pathOnly.replace(/\$\{query\}$/, '').replace(/\$\{[^}]*\}/g, '{p}')
}

const unmatched = []
const matched = new Set()
const srcFor = {}

for (const c of calls) {
  if (!c.url.startsWith('/')) continue
  const np = normalize(c.url)
  const key = `${c.method} ${np}`
  srcFor[key] = (srcFor[key] || new Set()).add(c.fn)
  if (backend.has(key)) matched.add(key)
  else unmatched.push({ method: c.method, url: c.url, fn: c.fn })
}

console.log('===== 前端调用总数 =====', calls.length)
console.log('===== 有后端匹配 =====', matched.size)
console.log('===== 前后端不一致（前端有，后端路由无） =====', unmatched.length)
for (const u of unmatched) {
  console.log(`  [${u.fn}] ${u.method} ${u.url}`)
}
console.log('===== 已匹配的调用 =====')
for (const k of [...matched].sort()) {
  console.log('  OK', k)
}
