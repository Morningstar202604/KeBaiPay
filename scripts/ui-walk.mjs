import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const SHOTS = 'C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\opencode\\shots'
const USER_PHONE = '139******11'
const USER_PWD = 'Abc12345'
const PAY_PWD = '123456'
const ADMIN_USER = 'admin'
const ADMIN_PWD = 'ChangeAdmin2026'

fs.mkdirSync(SHOTS, { recursive: true })

const apiLog = []
const consoleErrors = []
const pageErrors = []

async function waitApp(page, ms = 900) {
  await page.waitForSelector('#app', { state: 'attached' })
  await page.waitForTimeout(ms)
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`  [shot] ${name}`)
}

async function go(page, route) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'domcontentloaded' })
  await waitApp(page)
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[console] ${msg.text()}`)
  })
  page.on('pageerror', (err) => pageErrors.push(`[pageerror] ${err.message}`))
  page.on('response', (res) => {
    if (res.status() >= 400) apiLog.push(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`)
  })

  console.log('=== 用户端 (H5, 390x844) ===')

  await go(page, 'home')
  await shot(page, '01-home-guest')

  await go(page, 'login')
  await shot(page, '02-login')
  await page.fill('#credential', USER_PHONE)
  await page.fill('#password', USER_PWD)
  await page.click('#btnLogin')
  await waitApp(page, 1200)
  await shot(page, '03-home-logged-in')

  await go(page, 'wallet')
  await shot(page, '04-wallet')

  await go(page, 'bills')
  await waitApp(page, 1200)
  await shot(page, '05-bills')

  await go(page, 'recharge')
  await waitApp(page, 1000)
  await shot(page, '06-recharge-empty')
  await page.fill('#amount', '66.66')
  await page.fill('#payPassword', PAY_PWD)
  await shot(page, '06-recharge-filled')
  await page.click('#btnRecharge')
  await waitApp(page, 1500)
  await shot(page, '07-recharge-after')

  await go(page, 'withdrawals')
  await waitApp(page, 1000)
  await shot(page, '08-withdrawals')

  await go(page, 'transfers')
  await waitApp(page, 1000)
  await shot(page, '09-transfers')

  await go(page, 'redpacket')
  await waitApp(page, 1000)
  await shot(page, '10-redpacket')

  await go(page, 'profile')
  await shot(page, '11-profile')

  await go(page, 'security')
  await shot(page, '12-security')

  await go(page, 'identity')
  await shot(page, '13-identity')

  await go(page, 'register')
  await shot(page, '14-register')

  await go(page, 'qrcode')
  await waitApp(page, 1000)
  await shot(page, '15-qrcode')

  console.log('=== 管理端 (1280x900) ===')
  await page.setViewportSize({ width: 1280, height: 900 })

  await go(page, 'adminLogin')
  await shot(page, '16-admin-login')
  await page.fill('#username', ADMIN_USER)
  await page.fill('#password', ADMIN_PWD)
  await page.click('#btnAdminLogin')
  await waitApp(page, 1200)
  await shot(page, '17-admin-dashboard')

  const adminRoutes = [
    'adminUsers', 'adminWithdrawals', 'adminMerchants', 'adminOrders',
    'adminFinance', 'adminReconciliation', 'adminRiskEvents', 'adminRiskRules',
    'adminChannels', 'adminConfigs', 'adminAuditLogs', 'adminLoginLogs',
  ]
  for (const r of adminRoutes) {
    await go(page, r)
    await waitApp(page, 1100)
    await shot(page, `18-${r}`)
  }

  console.log('=== 商户端 ===')
  await go(page, 'merchantRegister')
  await waitApp(page, 1000)
  await shot(page, '19-merchant-register')

  await go(page, 'merchantDashboard')
  await waitApp(page, 1000)
  await shot(page, '20-merchant-dashboard')

  console.log('\\n===== API 异常 (>=400) =====')
  console.log(apiLog.length ? apiLog.join('\\n') : '  (无)')
  console.log('===== 控制台错误 =====')
  console.log(consoleErrors.length ? consoleErrors.join('\\n') : '  (无)')
  console.log('===== 页面 JS 错误 =====')
  console.log(pageErrors.length ? pageErrors.join('\\n') : '  (无)')

  await browser.close()
}

main().catch((e) => {
  console.error('脚本异常:', e)
  process.exit(1)
})
