import { createHmac } from 'node:crypto'

const BASE = 'http://localhost:3000'
const MOCK_SECRET = 'change-mock-secret-in-dev'
const PHONE = '139******11'
const PASSWORD = 'Abc12345'
const PAY_PASSWORD = '123456'
const ADMIN_USER = 'admin'
const ADMIN_PASSWORD = 'ChangeAdmin2026'

let passed = 0
let failed = 0

function assert(cond, label, extra = '') {
  if (cond) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}  ${extra}`)
  }
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* ignore */
  }
  return { status: res.status, data }
}

function mockSign(str) {
  return createHmac('sha256', MOCK_SECRET).update(str).digest('hex')
}

const yuan = (v) => (typeof v === 'string' ? parseFloat(v) : v)

async function getBalance(token) {
  const res = await api('GET', '/accounts/me', undefined, token)
  const d = res.data
  return {
    available: yuan(d?.availableBalanceYuan),
    frozen: yuan(d?.frozenBalanceYuan),
    total: yuan(d?.totalBalanceYuan),
  }
}

async function main() {
  console.log('=== 1. 用户登录 ===')
  const login = await api('POST', '/auth/login', { phone: PHONE, password: PASSWORD })
  assert((login.status === 200 || login.status === 201) && login.data?.token, '登录成功返回 token', JSON.stringify(login.data))
  const token = login.data?.token
  if (!token) {
    console.log('登录失败，中止后续验证')
    process.exit(1)
  }

  console.log('=== 2. 管理员登录 ===')
  const adminLogin = await api('POST', '/admin/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD })
  assert((adminLogin.status === 200 || adminLogin.status === 201) && adminLogin.data?.token, '管理员登录成功返回 token', JSON.stringify(adminLogin.data))
  const adminToken = adminLogin.data?.token
  if (!adminToken) {
    console.log('管理员登录失败，中止提现相关验证')
    process.exit(1)
  }

  console.log('=== 3. 查询初始余额 ===')
  let bal = await getBalance(token)
  console.log('  当前余额:', JSON.stringify(bal))
  const beforeAvailable = bal.available

  console.log('=== 4. 创建充值订单 (mock 渠道) ===')
  const idem1 = `live-verify-recharge-${Date.now()}`
  const recharge = await api('POST', '/transactions/recharge', {
    amount: 88.88,
    payPassword: PAY_PASSWORD,
    idempotencyKey: idem1,
  }, token)
  console.log('  充值响应:', JSON.stringify(recharge.data))
  assert(recharge.status === 201 || recharge.status === 200, '充值订单创建', JSON.stringify(recharge.data))
  const orderNo = recharge.data?.orderNo
  const channelOrderNo = recharge.data?.channelOrderNo
  assert(!!orderNo, '充值订单号存在')

  console.log('=== 5. 幂等：同一 idempotencyKey 再次充值应返回同一订单 ===')
  const recharge2 = await api('POST', '/transactions/recharge', {
    amount: 88.88,
    payPassword: PAY_PASSWORD,
    idempotencyKey: idem1,
  }, token)
  assert(recharge2.data?.orderNo === orderNo, '幂等充值返回同一订单', JSON.stringify(recharge2.data))

  console.log('=== 6. mock 回调 (成功) ===')
  const cbBody = {
    orderNo,
    channelOrderNo: channelOrderNo || `MOCK_R_${orderNo}`,
    amount: '8888',
    status: 'SUCCESS',
  }
  const sig = mockSign(`${cbBody.orderNo}${cbBody.channelOrderNo}${cbBody.amount}`)
  const cb = await fetch(`${BASE}/webhooks/recharge/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': sig },
    body: JSON.stringify(cbBody),
  })
  const cbText = await cb.text()
  console.log('  回调响应:', cb.status, cbText)
  assert(cb.status === 200 || cb.status === 201, '充值回调处理成功', cbText)

  console.log('=== 7. 回调幂等：重复回调应被拦截 ===')
  const cb2 = await fetch(`${BASE}/webhooks/recharge/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': sig },
    body: JSON.stringify(cbBody),
  })
  console.log('  重复回调响应:', cb2.status, await cb2.text())

  console.log('=== 8. 回调伪造签名应被拒绝 ===')
  const badSig = mockSign('fake-orderfakeno999')
  const cb3 = await fetch(`${BASE}/webhooks/recharge/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': badSig },
    body: JSON.stringify({ ...cbBody, orderNo: 'FAKE-ORDER' }),
  })
  console.log('  伪造回调响应:', cb3.status, await cb3.text())
  assert(cb3.status >= 400, '伪造签名回调被拒绝')

  console.log('=== 9. 查询充值后余额 ===')
  await new Promise((r) => setTimeout(r, 500))
  bal = await getBalance(token)
  console.log('  充值后余额:', JSON.stringify(bal))
  assert(bal.available > beforeAvailable, `充值后余额增加 (${beforeAvailable} -> ${bal.available})`)

  console.log('=== 10. 查询账单流水 ===')
  const bills = await api('GET', '/bills', undefined, token)
  console.log('  账单响应:', JSON.stringify(bills.data)?.slice(0, 200))
  assert(bills.status === 200, '账单查询成功', JSON.stringify(bills.data))

  console.log('=== 11. 申请提现 (50元, mock 渠道银行卡) ===')
  const wIdem = `live-verify-withdraw-${Date.now()}`
  const wRes = await api('POST', '/withdrawals', {
    amount: 50,
    payPassword: PAY_PASSWORD,
    channelAccount: '6222020202020202020',
    remark: 'e2e提现验证',
    idempotencyKey: wIdem,
  }, token)
  console.log('  提现响应:', JSON.stringify(wRes.data))
  assert(wRes.status === 201 && wRes.data?.orderNo?.startsWith?.('W'), '提现订单创建(PENDING)', JSON.stringify(wRes.data))
  const wOrder = wRes.data
  assert(wOrder?.status === 'PENDING', '提现订单状态为 PENDING', wOrder?.status)

  console.log('=== 12. 提现后冻结余额 ===')
  await new Promise((r) => setTimeout(r, 300))
  bal = await getBalance(token)
  console.log('  提现后余额:', JSON.stringify(bal))
  assert(Math.abs(bal.frozen - 50) < 0.01, `冻结余额为 50 (实际 ${bal.frozen})`)
  assert(Math.abs(bal.available - (beforeAvailable + 88.88 - 50)) < 0.01, `可用余额扣减 50 (实际 ${bal.available})`)

  console.log('=== 13. 管理员审核通过 ===')
  const approve = await api('POST', `/admin/withdrawals/${wOrder.id}/approve`, undefined, adminToken)
  console.log('  审核响应:', JSON.stringify(approve.data))
  assert((approve.status === 200 || approve.status === 201) && approve.data?.status === 'PROCESSING', '审核后状态为 PROCESSING', JSON.stringify(approve.data))
  const wChannelOrderNo = approve.data?.channelOrderNo
  assert(!!wChannelOrderNo, '已保存渠道代付单号', wChannelOrderNo)

  console.log('=== 14. mock 代付回调 (成功) ===')
  const payoutBody = {
    orderNo: wOrder.orderNo,
    channelOrderNo: wChannelOrderNo || `MOCK_P_${wOrder.orderNo}`,
    status: 'SUCCESS',
  }
  const pSig = mockSign(`${payoutBody.orderNo}${payoutBody.channelOrderNo}${payoutBody.status}`)
  const pc = await fetch(`${BASE}/webhooks/payout/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': pSig },
    body: JSON.stringify(payoutBody),
  })
  const pcText = await pc.text()
  console.log('  代付回调响应:', pc.status, pcText)
  assert(pc.status === 200 || pc.status === 201, '代付回调处理成功', pcText)

  console.log('=== 15. 提现成功后余额 ===')
  await new Promise((r) => setTimeout(r, 500))
  bal = await getBalance(token)
  console.log('  提现成功后余额:', JSON.stringify(bal))
  assert(bal.frozen < 0.01, `冻结余额已清零 (实际 ${bal.frozen})`)
  assert(Math.abs(bal.available - (beforeAvailable + 88.88 - 50)) < 0.01, `可用余额不变 (实际 ${bal.available})`)
  assert(Math.abs(bal.total - (beforeAvailable + 88.88 - 50)) < 0.01, `总余额减少 50 (实际 ${bal.total})`)

  console.log('=== 16. 提现记录状态 ===')
  const wList = await api('GET', '/withdrawals', undefined, token)
  const latest = wList.data?.find?.((o) => o.id === wOrder.id)
  assert(latest?.status === 'SUCCESS', '提现记录状态为 SUCCESS', JSON.stringify(latest))

  console.log('=== 17. 申请提现2 (20元) 并审核拒绝 ===')
  const wRes2 = await api('POST', '/withdrawals', {
    amount: 20,
    payPassword: PAY_PASSWORD,
    channelAccount: '6222020202020202021',
    remark: 'e2e提现拒绝验证',
  }, token)
  console.log('  提现2响应:', JSON.stringify(wRes2.data))
  assert(wRes2.status === 201 && wRes2.data?.id, '提现2订单创建', JSON.stringify(wRes2.data))
  const reject = await api('POST', `/admin/withdrawals/${wRes2.data.id}/reject`, { reason: 'e2e测试拒绝' }, adminToken)
  console.log('  拒绝响应:', JSON.stringify(reject.data))
  assert((reject.status === 200 || reject.status === 201) && reject.data?.status === 'REJECTED', '审核拒绝后状态为 REJECTED', JSON.stringify(reject.data))

  console.log('=== 18. 拒绝后退款到余额 ===')
  await new Promise((r) => setTimeout(r, 500))
  bal = await getBalance(token)
  console.log('  拒绝后余额:', JSON.stringify(bal))
  assert(Math.abs(bal.available - (beforeAvailable + 88.88 - 50)) < 0.01, `可用余额恢复 20 (实际 ${bal.available})`)

  console.log('\n===== 结果 =====')
  console.log(`  通过: ${passed}, 失败: ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('脚本异常:', e)
  process.exit(1)
})
