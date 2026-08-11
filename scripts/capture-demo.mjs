/**
 * KeBaiPay 演示捕获脚本
 * ----------------------
 * 用 Playwright 对商户后台 / 用户 H5 / 管理后台 做完整可视化走查：
 *  - 每个视图截图到 demo/screenshots/
 *  - 每端全程录屏到 demo/videos/
 *
 * 运行：node scripts/capture-demo.mjs
 * 依赖：npm i -D playwright（本仓库已内置），需本机可运行 chromium。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const BASE = process.env.DEMO_BASE || 'http://localhost:3000'
const SHOT = path.join(root, 'demo', 'screenshots')
const VID = path.join(root, 'demo', 'videos')
fs.mkdirSync(SHOT, { recursive: true })
fs.mkdirSync(VID, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(page, name) {
  await sleep(600)
  const p = path.join(SHOT, name + '.png')
  await page.screenshot({ path: p })
  console.log('  📸', name)
}

/** 通用登录：填表单 → 点按钮 */
async function login(page, selector, creds) {
  const inputs = await page.$$(selector + ' input')
  await inputs[0].fill(creds[0])
  await inputs[1].fill(creds[1])
  await page.click(selector + ' button[type="button"], ' + selector + ' .el-button--primary')
  await sleep(1500)
}

/** 商户后台 */
async function portal() {
  const ctx = await chromium.launch({ headless: true }).then((b) =>
    b.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: VID, size: { width: 1440, height: 900 } },
    }),
  )
  const page = await ctx.newPage()
  await page.goto(`${BASE}/portal/#/login`, { waitUntil: 'networkidle' })
  await shot(page, 'portal-login')
  await login(page, '.login-card', ['13800000001', 'Abc12345'])
  const views = [
    ['dashboard', 'portal-dashboard'],
    ['orders', 'portal-orders'],
    ['reconciliation', 'portal-reconciliation'],
    ['qrcodes', 'portal-qrcodes'],
    ['apps', 'portal-apps'],
    ['merchant', 'portal-merchant'],
  ]
  for (const [route, name] of views) {
    await page.goto(`${BASE}/portal/#/${route}`, { waitUntil: 'networkidle' })
    await shot(page, name)
  }
  await page.close()
  await ctx.browser().close()
}

/** 用户 H5 */
async function h5() {
  const ctx = await chromium.launch({ headless: true }).then((b) =>
    b.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      recordVideo: { dir: VID, size: { width: 390, height: 844 } },
    }),
  )
  const page = await ctx.newPage()
  await page.goto(`${BASE}/h5/#/login`, { waitUntil: 'networkidle' })
  await shot(page, 'h5-login')
  await login(page, '.login-card', ['13800000001', 'Abc12345'])
  const views = [
    ['home', 'h5-home'],
    ['recharge', 'h5-recharge'],
    ['transfer', 'h5-transfer'],
    ['withdraw', 'h5-withdraw'],
    ['redpacket', 'h5-redpacket'],
    ['bills', 'h5-bills'],
    ['cashier', 'h5-cashier'],
  ]
  for (const [route, name] of views) {
    await page.goto(`${BASE}/h5/#/${route}`, { waitUntil: 'networkidle' })
    await shot(page, name)
  }
  await page.close()
  await ctx.browser().close()
}

/** 管理后台 */
async function admin() {
  const ctx = await chromium.launch({ headless: true }).then((b) =>
    b.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: VID, size: { width: 1440, height: 900 } },
    }),
  )
  const page = await ctx.newPage()
  await page.goto(`${BASE}/admin/#/login`, { waitUntil: 'networkidle' })
  await shot(page, 'admin-login')
  await login(page, '.login-card', ['admin', 'Admin2026'])
  const views = [
    ['dashboard', 'admin-dashboard'],
    ['users', 'admin-users'],
    ['merchants', 'admin-merchants'],
    ['withdrawals', 'admin-withdrawals'],
    ['orders', 'admin-orders'],
    ['finance', 'admin-finance'],
    ['risk', 'admin-risk'],
  ]
  for (const [route, name] of views) {
    await page.goto(`${BASE}/admin/#/${route}`, { waitUntil: 'networkidle' })
    await shot(page, name)
  }
  await page.close()
  await ctx.browser().close()
}

// 收尾：把各端录屏重命名（playwright 存为随机名）
function renameVideos() {
  const files = fs.readdirSync(VID).filter((f) => f.endsWith('.webm'))
  const map = {
    'portal': 'portal-demo',
    'h5': 'h5-demo',
    'admin': 'admin-demo',
  }
  // 按创建时间排序，分别对应 portal/h5/admin
  files.sort((a, b) => fs.statSync(path.join(VID, a)).mtimeMs - fs.statSync(path.join(VID, b)).mtimeMs)
  const keys = Object.keys(map)
  files.forEach((f, i) => {
    const newName = (map[keys[i]] || 'demo-' + i) + '.webm'
    fs.renameSync(path.join(VID, f), path.join(VID, newName))
    console.log('  🎬', newName)
  })
}

console.log('=== 开始捕获商户后台 ===')
await portal()
console.log('=== 开始捕获用户 H5 ===')
await h5()
console.log('=== 开始捕获管理后台 ===')
await admin()
renameVideos()
console.log('\n完成：截图在 demo/screenshots/，视频在 demo/videos/')
