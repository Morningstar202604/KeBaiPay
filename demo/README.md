# KeBaiPay 演示与功能走查

> KeBaiPay 的**可视化功能演示**：三端逐步截图 + 分端录屏 + 精编合集视频。
> 录制环境：本地 `NODE_ENV=development` + mock 渠道 + 演示数据。
> 本平台为**合规聚合收单技术服务**：资金绝不过平台，不设余额/充值/提现/转账/红包/分账/担保。

## 🎬 精编合集（推荐直接看这个）

<p align="center">
  <video src="videos/kebaipay-showcase.mp4" controls width="720" poster="videos/showcase-preview.gif"></video>
</p>
<p align="center">
  <a href="videos/kebaipay-showcase.mp4"><img src="videos/showcase-preview.gif" alt="点击播放 KeBaiPay 演示视频" width="720"/></a>
</p>

## 📼 分端视频

| 端 | 视频 | 内容 |
|----|------|------|
| **精编合集（推荐）** | [`videos/kebaipay-showcase.mp4`](videos/kebaipay-showcase.mp4) | **标题卡 + 三端精华**（商户后台 → 用户H5 → 管理后台），场景淡入过渡，H.264 统一 1440×900 |
| 管理后台 | [`videos/admin-demo.webm`](videos/admin-demo.webm) | 登录 → 数据概览 → 用户 → 商户 → 实名审核 → 订单 → 财务 → 风控 → 智能体 |

> 使用与配置总指南：[docs/USER_CONFIGURATION_GUIDE.md](../docs/USER_CONFIGURATION_GUIDE.md)

## 🔑 演示账号

| 角色 | 账号 | 密码 | 入口 |
|------|------|------|------|
| 付款方用户 | `13800000001` | `Abc12345`（支付密码 `123456`） | `/portal`、`/h5` |
| 管理员 | `admin` | `ChangeAdmin2026` | `/admin` |

> 商户已入驻并审核通过（"MVP演示商户"），含若干收单订单、智能体（店长/风控等）。平台不持有任何用户资金。

---

## 一、商户后台（`/portal`）

| 视图 | 截图 |
|------|------|
| 登录 | ![登录](screenshots/portal-login.png) |
| 数据看板（今日/近7天/近30天收单额、手续费） | ![看板](screenshots/portal-dashboard.png) |
| 订单管理（筛选 + 回调状态 + 重试回调） | ![订单](screenshots/portal-orders.png) |
| 对账查询 | ![对账](screenshots/portal-reconciliation.png) |
| 收款码 | ![收款码](screenshots/portal-qrcodes.png) |
| 应用管理 | ![应用](screenshots/portal-apps.png) |
| 商户资料 | ![商户](screenshots/portal-merchant.png) |

## 二、用户 H5（`/h5`）

| 视图 | 截图 |
|------|------|
| 登录 | ![登录](screenshots/h5-login.png) |
| AI 智能助手（选智能体→授权→对话） | ![AI助手](screenshots/h5-agent.png) |
| 账单 | ![账单](screenshots/h5-bills.png) |

## 三、管理后台（`/admin`）

| 视图 | 截图 |
|------|------|
| 登录 | ![登录](screenshots/admin-login.png) |
| 用户管理 | ![用户](screenshots/admin-users.png) |
| 商户管理 | ![商户](screenshots/admin-merchants.png) |
| 实名审核 | ![实名](screenshots/admin-merchants.png) |
| 支付订单 | ![订单](screenshots/admin-orders.png) |
| 财务总览 | ![财务](screenshots/admin-finance.png) |
| 风控事件 | ![风控](screenshots/admin-risk.png) |

---

## 说明

演示使用 **mock 支付渠道 + 演示数据**（联调用）；真实资金进出按 `docs/EXTERNAL_QUICKSTART.md` 接入真实持牌渠道。
