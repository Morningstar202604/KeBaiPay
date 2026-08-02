import { chromium } from 'playwright'

const base = 'http://localhost:3000'

const pages = [
  ['#home', 'guest', 'home'],
  ['#login', 'guest', 'login'],
  ['#register', 'guest', 'register'],
  ['#wallet', 'user', 'wallet'],
  ['#bills', 'user', 'bills'],
  ['#recharge', 'user', 'recharge'],
  ['#withdrawals', 'user', 'withdrawals'],
  ['#transfers', 'user', 'transfers'],
  ['#redpacket', 'user', 'redpacket'],
  ['#profile', 'user', 'profile'],
  ['#security', 'user', 'security'],
  ['#identity', 'user', 'identity'],
  ['#qrcode', 'user', 'qrcode'],
  ['#merchant', 'user', 'merchant'],
  ['#merchantApps', 'user', 'merchantApps'],
  ['#merchantOrders', 'user', 'merchantOrders'],
  ['#merchantQrcodes', 'user', 'merchantQrcodes'],
  ['#merchantSettle', 'user', 'merchantSettle'],
  ['#adminLogin', 'admin', 'adminLogin'],
  ['#adminDashboard', 'admin', 'adminDashboard'],
  ['#adminUsers', 'admin', 'adminUsers'],
  ['#adminWithdrawals', 'admin', 'adminWithdrawals'],
  ['#adminMerchants', 'admin', 'adminMerchants'],
  ['#adminOrders', 'admin', 'adminOrders'],
  ['#adminFinance', 'admin', 'adminFinance'],
  ['#adminReconciliation', 'admin', 'adminReconciliation'],
  ['#adminRiskEvents', 'admin', 'adminRiskEvents'],
  ['#adminRiskRules', 'admin', 'adminRiskRules'],
  ['#adminChannels', 'admin', 'adminChannels'],
  ['#adminConfigs', 'admin', 'adminConfigs'],
  ['#adminAuditLogs', 'admin', 'adminAuditLogs'],
  ['#adminLoginLogs', 'admin', 'adminLoginLogs'],
]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

async function loginUser() {
  await page.goto(`${base}/#login`)
  await page.fill('#credential', '139******11')
  await page.fill('#password', 'Abc12345')
  await page.click('#btnLogin')
  await page.waitForTimeout(600)
}
async function loginAdmin() {
  await page.goto(`${base}/#adminLogin`)
  await page.fill('#username', 'admin')
  await page.fill('#password', 'ChangeAdmin2026')
  await page.click('#btnAdminLogin')
  await page.waitForTimeout(600)
}

let last = 'guest'
for (const [hash, role, name] of pages) {
  if (role !== last) {
    if (role === 'user') await loginUser()
    else if (role === 'admin') await loginAdmin()
    last = role
  }
  await page.goto(`${base}/${hash}`)
  await page.waitForTimeout(350)
  const stats = await page.evaluate(() => {
    const container = document.querySelector('.container') || document.body
    const rect = container.getBoundingClientRect()
    const text = (container.innerText || '').trim()
    return {
      bodyTextLen: text.length,
      buttons: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input').length,
      containers: document.querySelectorAll('.card, .panel, .box').length,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      hEmpty: rect.height < 40,
      title: document.title,
    }
  })
  console.log(`${name.padEnd(20)} text=${String(stats.bodyTextLen).padStart(5)} btn=${String(stats.buttons).padStart(2)} inp=${String(stats.inputs).padStart(2)} cards=${String(stats.containers).padStart(2)} overflowX=${stats.overflowX} hEmpty=${stats.hEmpty}`)
}
console.log('--- JS errors:', errors.length ? errors : 'NONE')
await browser.close()
