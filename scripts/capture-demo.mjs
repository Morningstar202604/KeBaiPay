import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const SHOT = path.join(root, 'demo', 'screenshots')
const VID = path.join(root, 'demo', 'videos')
fs.mkdirSync(SHOT, { recursive: true }); fs.mkdirSync(VID, { recursive: true })
const BASE = process.env.DEMO_BASE || 'http://localhost:3000'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function shot(page, name){ await sleep(700); await page.screenshot({ path: path.join(SHOT, name + '.png') }); console.log('📸', name) }

async function login(page, creds){
  const ins = await page.$$('.login-card input')
  await ins[0].fill(creds[0]); await ins[1].fill(creds[1])
  await page.click('.login-card button'); await sleep(1600)
}

async function appFlow(app, base, loginCreds, views, shots){
  const browser = await chromium.launch({ headless: true })
  const vp = app==='h5' ? { width:390, height:844 } : { width:1440, height:900 }
  const ctx = await browser.newContext({ viewport: vp, isMobile: app==='h5', recordVideo: { dir: VID, size: vp } })
  const page = await ctx.newPage()
  await page.goto(`${base}${app==='h5'?'/h5':'/'}${app==='h5'?'/h5':'/portal'}`.replace(/\/\/\//,'//'), { waitUntil:'networkidle' })
  await page.goto(`${BASE}/${app==='h5'?'h5':app}/#/login`, { waitUntil:'networkidle' })
  await shot(page, `${app}-login`); await login(page, loginCreds)
  for (const [route, name] of views){ await page.goto(`${BASE}/${app==='h5'?'h5':app}/#/${route}`, { waitUntil:'networkidle' }); await sleep(1600); await shot(page, name) }
  await page.close(); await browser.close()
}

const browser = await chromium.launch({ headless: true })
// === 商户后台 ===
{
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, recordVideo:{dir:VID,size:{width:1440,height:900}} })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/portal/#/login`,{waitUntil:'networkidle'}); await shot(p,'portal-login'); await login(p,['13800000001','Abc12345'])
  for (const [r,n] of [['dashboard','portal-dashboard'],['orders','portal-orders'],['reconciliation','portal-reconciliation'],['qrcodes','portal-qrcodes'],['apps','portal-apps'],['merchant','portal-merchant']]){ await p.goto(`${BASE}/portal/#/${r}`,{waitUntil:'networkidle'}); await sleep(1600); await shot(p,n) }
  await p.close(); await ctx.close()
}
// === 用户 H5 ===
{
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, recordVideo:{dir:VID,size:{width:390,height:844}} })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/h5/#/login`,{waitUntil:'networkidle'}); await shot(p,'h5-login'); await login(p,['13800000001','Abc12345'])
  for (const [r,n] of [['home','h5-home'],['agent','h5-agent'],['recharge','h5-recharge'],['redpacket','h5-redpacket'],['cashier','h5-cashier'],['bills','h5-bills']]){ await p.goto(`${BASE}/h5/#/${r}`,{waitUntil:'networkidle'}); await sleep(1600); await shot(p,n) }
  await p.close(); await ctx.close()
}
// === 管理后台 ===
{
  const ctx = await browser.newContext({ viewport:{width:1440,height:900}, recordVideo:{dir:VID,size:{width:1440,height:900}} })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/admin/#/login`,{waitUntil:'networkidle'}); await shot(p,'admin-login'); await login(p,['admin',process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026'])
  for (const [r,n] of [['dashboard','admin-dashboard'],['users','admin-users'],['merchants','admin-merchants'],['withdrawals','admin-withdrawals'],['orders','admin-orders'],['finance','admin-finance'],['risk','admin-risk'],['agents','admin-agents']]){ await p.goto(`${BASE}/admin/#/${r}`,{waitUntil:'networkidle'}); await sleep(1600); await shot(p,n) }
  await p.close(); await ctx.close()
}
await browser.close()
// 重命名视频
const files = fs.readdirSync(VID).filter(f=>f.endsWith('.webm')).sort((a,b)=>fs.statSync(path.join(VID,a)).mtimeMs-fs.statSync(path.join(VID,b)).mtimeMs)
const names = ['portal-demo','h5-demo','admin-demo']
files.forEach((f,i)=>{ fs.renameSync(path.join(VID,f), path.join(VID,(names[i]||'demo-'+i)+'.webm')); console.log('🎬',names[i]||f) })
console.log('done')
