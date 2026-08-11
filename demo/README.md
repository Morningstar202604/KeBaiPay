# KeBaiPay 演示与功能走查

> 这是 KeBaiPay 的**可视化功能演示**。包含三端的逐步截图与全程录屏，展示真实运行界面（含演示数据）。
>
> 录制环境：本仓库本地 `npm run start:prod` 运行（`NODE_ENV=development` + mock 渠道 + 演示数据）。
> 复现：`node scripts/capture-demo.mjs`（需 playwright + chromium）。

## 🎬 演示视频

| 端 | 视频 | 内容 |
|----|------|------|
| 商户后台 | [`demo/videos/portal-demo.webm`](videos/portal-demo.webm) | 登录 → 数据看板 → 订单管理 → 对账 → 收款码 → 应用 → 商户资料 |
| 用户 H5（钱包） | [`demo/videos/h5-demo.webm`](videos/h5-demo.webm) | 登录 → 首页余额 → 充值 → 转账 → 提现 → 红包 → 账单 → 收银台 |
| 管理后台 | [`demo/videos/admin-demo.webm`](videos/admin-demo.webm) | 登录 → 数据概览 → 用户 → 商户 → 提现审核 → 订单 → 财务 → 风控 |
| 管理员审核交互 | [`demo/videos/admin-review.webm`](videos/admin-review.webm) | 管理员登录 → 提现审核列表（含通过/拒绝操作入口） |

> 审核录屏截图：
> ![提现审核列表](screenshots/admin-review-withdrawals.png)

## 🔑 演示账号

| 角色 | 账号 | 密码 | 入口 |
|------|------|------|------|
| 商户用户 | `13800000001` | `Abc12345`（支付密码 `123456`） | `/portal`（商户后台）、`/h5`（钱包） |
| 管理员 | `admin` | `Admin2026` | `/admin` |

> 商户 `13800000001` 已入驻并审核通过（"MVP演示商户"），账户余额 ¥10000，含 8 笔演示订单。

---

## 一、商户后台（`/portal`）—— 商户如何经营

> 面向已入驻商户：查看经营数据、管理订单、对账、收款码与应用。

| 视图 | 截图 |
|------|------|
| 登录页 | ![登录](screenshots/portal-login.png) |
| 数据看板（今日/近7天/近30天交易额、净收入，渐变柱状图） | ![看板](screenshots/portal-dashboard.png) |
| 订单管理（状态/日期筛选 + 回调状态 + 手动重试回调） | ![订单](screenshots/portal-orders.png) |
| 对账查询（按日汇总 + 汇总卡片） | ![对账](screenshots/portal-reconciliation.png) |
| 收款码（创建/删除） | ![收款码](screenshots/portal-qrcodes.png) |
| 应用管理（AppID/密钥，重置密钥） | ![应用](screenshots/portal-apps.png) |
| 商户资料（查看/修改） | ![商户](screenshots/portal-merchant.png) |

## 二、用户 H5 钱包（`/h5`）—— 用户如何使用

> 面向 C 端用户：查看余额、充值、转账、提现、发/领红包、账单、收银台付款。

| 视图 | 截图 |
|------|------|
| 登录页 | ![登录](screenshots/h5-login.png) |
| 首页（余额总览 + 快捷操作 + 最近账单） | ![首页](screenshots/h5-home.png) |
| 充值 | ![充值](screenshots/h5-recharge.png) |
| 转账 | ![转账](screenshots/h5-transfer.png) |
| 提现 | ![提现](screenshots/h5-withdraw.png) |
| 红包（发/领/列表） | ![红包](screenshots/h5-redpacket.png) |
| 账单（收支筛选） | ![账单](screenshots/h5-bills.png) |
| 收银台（建单 + 支付） | ![收银台](screenshots/h5-cashier.png) |

## 三、管理后台（`/admin`）—— 平台运营

> 面向平台运营：数据概览、用户/商户管理、提现审核、订单、财务、风控。

| 视图 | 截图 |
|------|------|
| 登录页 | ![登录](screenshots/admin-login.png) |
| 数据概览（用户/商户/订单/提现/待审核商户指标卡） | ![概览](screenshots/admin-dashboard.png) |
| 用户管理（搜索 + 冻结/解冻） | ![用户](screenshots/admin-users.png) |
| 商户管理（审核通过/驳回） | ![商户](screenshots/admin-merchants.png) |
| 提现审核（通过/拒绝） | ![提现](screenshots/admin-withdrawals.png) |
| 支付订单 | ![订单](screenshots/admin-orders.png) |
| 财务总览 | ![财务](screenshots/admin-finance.png) |
| 风控事件 | ![风控](screenshots/admin-risk.png) |

---

## 四、用户使用流程速览

1. **用户**：打开 `/h5` → 注册/登录 → 钱包首页看余额 → 充值/转账/提现/发红包 → 账单查流水 → 收银台付款。
2. **商户**：打开 `/portal` → 登录 →（未入驻则先提交入驻申请，管理员审核）→ 数据看板看经营 → 订单管理发货/重试回调 → 对账 → 配置收款码与开放应用。
3. **管理员**：打开 `/admin` → 登录 → 审核商户入驻/实名/提现 → 查看财务与风控 → 配置支付渠道。

> 说明：演示为 **mock 支付渠道 + 演示数据**，用于流程演示与联调。真实资金进出需按 `docs/EXTERNAL_QUICKSTART.md` 接入真实支付渠道。
