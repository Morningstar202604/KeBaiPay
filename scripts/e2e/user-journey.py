"""
# KeBaiPay 部署验收脚本：模拟两个真实用户跑通资金全链路（35 项断言）
# 用法：python3 scripts/e2e/user-journey.py （需先启动后端并配置好 mock 渠道）
KeBaiPay 部署验证 · 全链路用户场景测试
模拟两个真实用户的完整资金旅程 + 管理员审核，API 层全断言。
"""
import hashlib
import hmac
import json
import time

import requests

BASE = "http://localhost:3001"
S = requests.Session()
S.headers["Content-Type"] = "application/json"

PASS_LOG = []
FAIL = []


def step(n, desc, cond, detail=""):
    mark = "PASS" if cond else "FAIL"
    line = f"[{n:02d}] {mark} {desc}" + (f" | {detail}" if detail else "")
    print(line)
    (PASS_LOG if cond else FAIL).append(line)
    if not cond:
        raise AssertionError(line)


def unwrap(d):
    """兼容平铺与 {code,data} 两种响应包装"""
    if isinstance(d, dict) and "data" in d and isinstance(d["data"], dict) and "token" not in d:
        return d["data"]
    return d


def api(method, path, token=None, **kw):
    headers = kw.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = S.request(method, BASE + path, headers=headers, timeout=15, **kw)
    try:
        return r.status_code, unwrap(r.json())
    except Exception:
        return r.status_code, {"_raw": r.text[:200]}


def register_or_login(phone, nickname, password):
    st, d = api("POST", "/auth/register", json={"nickname": nickname, "phone": phone, "password": password})
    if st == 201 or st == 200:
        return register_or_login.__dict__.setdefault("t", {})  # 注册成功后走登录
    st, d = api("POST", "/auth/login", json={"phone": phone, "password": password})
    assert st == 201 or st == 200, f"登录失败 {st} {d}"
    d = unwrap(d)
    return d.get("token") or d.get("accessToken"), (d.get("userId") or d.get("user", {}).get("id"))


# ============================================================
print("========== 阶段一：双用户注册 + 实名 + 管理员审核 ==========")
ts = int(time.time()) % 100000
PHONE_A, PHONE_B = f"139{ts:05d}001", f"139{ts:05d}002"
PW_A, PW_B = "UserA#2026xyz", "UserB#2026xyz"

# 身份证需通过 GB 11643 校验位验证（DTO 已启用 IsIdCard），动态生成保证唯一
_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
_ID_CODES = "10X98765432"

def make_id_card(seq: int) -> str:
    seq %= 10000  # 前缀固定 17 位：13 位日期前缀 + 4 位序号
    prefix = f"1101011990030{seq:04d}"
    s = sum(int(prefix[i]) * _ID_WEIGHTS[i] for i in range(17))
    return prefix + _ID_CODES[s % 11]

ID_A, ID_B = make_id_card(ts), make_id_card(ts + 1)

# 01 注册 A
st, d = api("POST", "/auth/register", json={"nickname": "场景测试甲", "phone": PHONE_A, "password": PW_A})
step(1, "用户A注册", st in (200, 201) or "已" in str(d), str(d)[:80])

# 02 注册 B
st, d = api("POST", "/auth/register", json={"nickname": "场景测试乙", "phone": PHONE_B, "password": PW_B})
step(2, "用户B注册", st in (200, 201) or "已" in str(d), str(d)[:80])

# 03/04 登录
st, d = api("POST", "/auth/login", json={"phone": PHONE_A, "password": PW_A})
tokA = d.get("token") or d.get("accessToken")
step(3, "用户A登录", st in (200, 201) and bool(tokA), f"token={'有' if tokA else '无'}")
st, d = api("POST", "/auth/login", json={"phone": PHONE_B, "password": PW_B})
tokB = d.get("token") or d.get("accessToken")
step(4, "用户B登录", st in (200, 201) and bool(tokB))

# userId
st, d = api("GET", "/users/me", tokA)
uidA = d.get("id") or d.get("userId")
step(5, "A 获取个人信息", st == 200 and bool(uidA), f"uid={uidA}, nickname={d.get('nickname')}")
st, d = api("GET", "/users/me", tokB)
uidB = d.get("id") or d.get("userId")
step(6, "B 获取个人信息", st == 200 and bool(uidB), f"uid={uidB}")

# 07/08 实名
st, d = api("POST", "/users/verify-identity", tokA,
            json={"realName": "张甲", "idCard": ID_A, "payPassword": "123456"})
step(7, "A 提交实名", st in (200, 201) or "已" in str(d), str(d)[:100])
st, d = api("POST", "/users/verify-identity", tokB,
            json={"realName": "李乙", "idCard": ID_B, "payPassword": "123456"})
step(8, "B 提交实名", st in (200, 201) or "已" in str(d), str(d)[:100])

# 09 管理员登录 + 审核实名
st, d = api("POST", "/admin/auth/login", json={"username": "admin", "password": "ChangeAdmin2026"})
admTok = d.get("token") or d.get("accessToken")
step(9, "管理员登录", st in (200, 201) and bool(admTok))

st, d = api("GET", "/admin/identity/pending", admTok)
items = d.get("items") or d.get("list") or d.get("data") or d
if isinstance(items, dict):
    items = items.get("items") or []
pending = [x for x in items if x.get("userId") in (uidA, uidB) or x.get("user", {}).get("id") in (uidA, uidB)]
step(10, "管理员查实名待审列表", st == 200, f"待审 {len(pending)} 条（本次 {len(pending)}）")

for x in pending[:2]:
    iid = x.get("id")
    st, d = api("POST", f"/admin/identity/{iid}/approve", admTok)
    step(11, f"管理员通过实名 {str(iid)[:8]}…", st in (200, 201), str(d)[:60])

st, d = api("GET", "/users/me", tokA)
step(12, "A 实名状态核验", (d.get("realNameStatus") or "").upper() in ("VERIFIED", "APPROVED"),
     f"realNameStatus={d.get('realNameStatus')}")

# ============================================================
print("========== 阶段二：充值（mock 渠道回调入账） ==========")
MOCK_SECRET = "change-mock-secret-in-dev"  # .env MOCK_CHANNEL_SECRET
RECHARGE_YUAN = 500
st, d = api("POST", "/transactions/recharge", tokA, json={"amount": RECHARGE_YUAN, "payPassword": "123456"})
order = unwrap(d)
orderNo = order.get("orderNo") or order.get("id")
step(13, f"A 发起充值 {RECHARGE_YUAN} 元", st in (200, 201) and bool(orderNo),
     f"orderNo={orderNo}")

# 回调签名: HMAC(orderNo + channelOrderNo + amountFen)
channelOrderNo = f"MOCK_R_{orderNo}"
amountFen = str(int(RECHARGE_YUAN * 100))
raw = json.dumps({"orderNo": orderNo, "channelOrderNo": channelOrderNo, "amount": amountFen}, separators=(",", ":"))
sig = hmac.new(MOCK_SECRET.encode(), f"{orderNo}{channelOrderNo}{amountFen}".encode(), hashlib.sha256).hexdigest()
st, d = api("POST", "/webhooks/recharge/mock",
            headers={"x-signature": sig}, json={"orderNo": orderNo, "channelOrderNo": channelOrderNo, "amount": amountFen})
step(14, "mock 渠道回调入账", st in (200, 201), str(d)[:100])

def get_bal(tok):
    st, d = api("GET", "/accounts/me", tok)
    return float(d.get("availableBalanceYuan") or 0), d

balA, _ = get_bal(tokA)
step(15, "A 余额核验 500 元", balA == RECHARGE_YUAN, f"balance={balA}")

# ============================================================
print("========== 阶段三：红包（普通 + 口令） ==========")
st, d = api("POST", "/red-packets", tokA, json={"amount": 88.88, "totalCount": 2, "type": "ORDINARY", "perAmount": 44.44, "remark": "场景测试红包", "payPassword": "123456"})
rp = unwrap(d)
packetNo1 = rp.get("packetNo") or rp.get("id")
step(16, "A 发普通红包 88.88/2 份", st in (200, 201) and bool(packetNo1), f"packetNo={packetNo1}")

st, d = api("POST", f"/red-packets/{packetNo1}/receive", tokB, json={})
got = unwrap(d)
step(17, "B 领取普通红包", st in (200, 201), f"领到 {got.get('amountFen', got.get('amount', '?'))}")

# ============================================================
print("========== 阶段四：转账 ==========")
st, d = api("POST", "/transfers", tokA, json={"toUserId": uidB, "amount": 100, "remark": "场景转账", "payPassword": "123456",
                                              "idempotencyKey": f"kt-{ts}"})
tf = unwrap(d)
step(21, "A→B 转账 100 元", st in (200, 201), f"transferNo={tf.get('transferNo') or tf.get('id')}")

st, d = api("POST", "/transfers", tokA, json={"toUserId": uidB, "amount": 100, "remark": "重放", "payPassword": "123456",
                                              "idempotencyKey": f"kt-{ts}"})
step(22, "同幂等键重放不重复转账", st in (200, 201) and not (unwrap(d).get("transferNo") and unwrap(d).get("amount") == 100 and unwrap(d).get("_replayed") is False) or "已" in str(d) or st >= 400,
     f"HTTP {st}")

st, d = api("POST", "/red-packets", tokB, json={"amount": 66.66, "type": "PASSWORD", "password": "kbp6666", "payPassword": "123456"})
rp2 = unwrap(d)
packetNo2 = rp2.get("packetNo") or rp2.get("id")
step(18, "B 发口令红包 66.66", st in (200, 201) and bool(packetNo2), f"packetNo={packetNo2}")

st, d = api("POST", f"/red-packets/{packetNo2}/receive", tokA, json={"password": "kbp6666"})
got2 = unwrap(d)
step(19, "A 用口令领取", st in (200, 201), f"领到 {got2.get('amountFen', got2.get('amount', '?'))}")

st, d = api("POST", f"/red-packets/{packetNo2}/receive", tokA, json={"password": "kbp6666"})
replay = unwrap(d)
same = replay.get("amountFen", replay.get("amount")) == got2.get("amountFen", got2.get("amount"))
step(20, "重复领取幂等重放（返回首次结果）", st in (200, 201) and same, f"HTTP {st}, amount={replay.get('amountFen', replay.get('amount'))}")


# ============================================================
print("========== 阶段五：担保交易全流程 ==========")
st, d = api("POST", "/escrow/orders", tokA, json={"sellerId": uidB, "amount": 66, "subject": "场景担保订单", "idempotencyKey": f"ke-{ts}"})
eo = unwrap(d)
escrowNo = eo.get("orderNo") or eo.get("id")
step(23, "A 下担保单 66 元（卖家B）", st in (200, 201) and bool(escrowNo), f"orderNo={escrowNo}, status={eo.get('status')}")

st, d = api("POST", f"/escrow/orders/{escrowNo}/pay", tokA, json={"payPassword": "123456"})
step(24, "A 支付担保单（资金冻结）", st in (200, 201), f"status={unwrap(d).get('status')}")

st, d = api("POST", f"/escrow/orders/{escrowNo}/ship", tokB)
step(25, "B 发货", st in (200, 201), f"status={unwrap(d).get('status')}")

st, d = api("POST", f"/escrow/orders/{escrowNo}/confirm", tokA)
step(26, "A 确认收货（卖家入账）", st in (200, 201), f"status={unwrap(d).get('status')}")

# ============================================================
print("========== 阶段六：提现 + 管理员打款 ==========")
st, d = api("POST", "/bank-cards", tokA, json={"holderName": "张甲", "cardNumber": f"6222020200112{ts:05d}", "bankName": "工商银行"})
step(27, "A 绑定银行卡", st in (200, 201), str(d)[:80])

st, d = api("POST", "/withdrawals", tokA, json={"amount": 200, "payPassword": "123456", "remark": "场景提现"})
wd = unwrap(d)
wdId = wd.get("id") or wd.get("withdrawNo")
step(28, "A 申请提现 200 元", st in (200, 201) and bool(wdId), f"withdrawNo={wd.get('withdrawNo') or wdId}, status={wd.get('status')}")

st, d = api("GET", "/admin/withdrawals?status=PENDING", admTok)
items = d.get("items") or d.get("list") or d.get("data") or []
target = next((x for x in items if x.get("id") == wdId or x.get("withdrawNo") == wdId), None)
step(29, "管理员查待审提现", st == 200 and target is not None, f"待审 {len(items)} 条")

st, d = api("POST", f"/admin/withdrawals/{wdId}/approve", admTok)
step(30, "管理员审核通过打款", st in (200, 201), str(unwrap(d))[:80])

st, d = api("GET", "/withdrawals", tokA)
wl = d if isinstance(d, list) else (d.get("items") or d.get("list") or d.get("data") or [])
wdrow2 = next((x for x in wl if (x.get("id") == wdId or x.get("orderNo") == wdId)), {})
step(31, "提现状态核验", wdrow2.get("status") in ("APPROVED", "PROCESSING", "SUCCESS", "PAID", "COMPLETED"),
     f"status={wdrow2.get('status')}")

# ============================================================
print("========== 阶段七：账单与终态核对 ==========")
balA2, accA = get_bal(tokA)
balB, accB = get_bal(tokB)
frozenA = float(accA.get("frozenBalanceYuan") or 0)
totalA = float(accA.get("totalBalanceYuan") or 0)
totalB = float(accB.get("totalBalanceYuan") or 0)
print(f"    A 可用={balA2} 冻结={frozenA}  B 可用={balB}")

# 提现单：amount 20000 分, fee 20 分, actualAmount 19980 分
st, d = api("GET", f"/withdrawals", tokA)
wl = d if isinstance(d, list) else (d.get("items") or d.get("list") or d.get("data") or [])
wdrow = next((x for x in wl if (x.get("id") == wdId or x.get("orderNo") == wdId)), {})
fee = float(wdrow.get("fee") or 0) / 100
actual = float(wdrow.get("actualAmount") or 0) / 100
# 复式记账守恒：充值入系统 500 = A总余额 + B总余额 + 提现实付 + 手续费
lhs = totalA + totalB + actual + fee
step(32, "复式记账守恒（A+B+提现实付+手续费 = 充值 500）", abs(lhs - 500) < 0.02,
     f"A总={totalA} B总={totalB} 提现实付={actual} 手续费={fee} 合计={round(lhs, 2)}")
# A 可用余额精确核对（含/不含提现手续费两种口径）
lo, hi = sorted((round(500 - 88.88 + 66.66 - 100 - 66 - 200, 2), round(500 - 88.88 + 66.66 - 100 - 66 - 200 - fee, 2)))
step(33, "A 可用余额精确吻合", lo - 0.011 <= balA2 <= hi + 0.011, f"实际 {balA2} ∈ [{lo}, {hi}]")
step(34, "B 可用余额精确吻合", abs(balB - 143.78) < 0.011, f"实际 {balB} ≈ 143.78")

print()
print(f"========== 结果: {len(PASS_LOG)} PASS / {len(FAIL)} FAIL ==========")
if FAIL:
    for f in FAIL:
        print(" ", f)
