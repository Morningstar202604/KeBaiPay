<template>
  <div>
    <div class="balance-card">
      <div class="bal-top">
        <span class="bal-label">账户总余额（元）</span>
        <span class="bal-badge">科佰钱包</span>
      </div>
      <div class="bal-value num">{{ account?.totalBalanceYuan || '0.00' }}</div>
      <div class="bal-sub">
        可用 <b>¥{{ account?.availableBalanceYuan || '0.00' }}</b>
        <span class="sep">·</span>
        冻结 <b>¥{{ account?.frozenBalanceYuan || '0.00' }}</b>
      </div>
    </div>

    <div class="grid">
      <div v-for="a in actions" :key="a.to" class="action" @click="$router.push(a.to)">
        <span class="action-icon" :style="{ background: a.bg, color: a.color }">
          <el-icon :size="20"><component :is="a.icon" /></el-icon>
        </span>
        <span>{{ a.label }}</span>
      </div>
    </div>

    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="list-head">
          <span>最近账单</span>
          <el-button link type="primary" @click="$router.push('/bills')">全部</el-button>
        </div>
      </template>
      <el-skeleton v-if="loading" :rows="4" animated />
      <div v-else-if="ledgers.length === 0" class="empty">
        <el-icon size="28"><Wallet /></el-icon>
        <p>暂无账单记录</p>
      </div>
      <div v-for="l in ledgers.slice(0, 6)" :key="l.id" class="ledger-row">
        <div class="ledger-left">
          <div>{{ typeText(l.type) }}</div>
          <div class="ledger-time">{{ fmt(l.createdAt) }}</div>
        </div>
        <div :class="['ledger-amt num', l.direction === 'INCOME' ? 'in' : 'out']">
          {{ l.direction === 'INCOME' ? '+' : '-' }}¥{{ l.amountYuan }}
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Refresh, Download, Present, Wallet } from '@element-plus/icons-vue'
import type { AccountInfo, LedgerItem } from '@/types'
import { fetchAccount } from '@/api/modules'
import { extractError } from '@/api/http'

const account = ref<AccountInfo | null>(null)
const loading = ref(true)
const ledgers = ref<LedgerItem[]>([])

const actions = [
  { to: '/recharge', label: '充值', icon: Plus, bg: '#e6f7f0', color: '#0c8a57' },
  { to: '/transfer', label: '转账', icon: Refresh, bg: '#e0f2fe', color: '#0369a1' },
  { to: '/withdraw', label: '提现', icon: Download, bg: '#fef3c7', color: '#b45309' },
  { to: '/redpacket', label: '红包', icon: Present, bg: '#fee2e2', color: '#b91c1c' },
]

function typeText(t: string) {
  const map: Record<string, string> = {
    RECHARGE: '充值', TRANSFER: '转账', WITHDRAW: '提现', RED_PACKET: '红包', PAYMENT: '付款',
    REFUND: '退款', FEE: '手续费', ADJUSTMENT: '调账', ESCROW: '担保', ESCROW_RELEASE: '担保解冻',
    ESCROW_REFUND: '担保退款', BATCH_TRANSFER: '批量转账', SUBSCRIPTION: '订阅', REFERRAL_REWARD: '邀请奖励',
  }
  return map[t] || t
}
function fmt(v: string) { return v ? v.replace('T', ' ').slice(5, 16) : '' }

onMounted(async () => {
  try {
    account.value = await fetchAccount()
    ledgers.value = account.value?.ledgers || []
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.balance-card {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(120% 120% at 0% 0%, rgba(255, 255, 255, 0.16), transparent 55%),
    linear-gradient(135deg, #0b1220, #0f1a2e 55%, #12334a);
  border-radius: 18px;
  color: #fff;
  padding: 22px 20px;
  margin-bottom: 14px;
  box-shadow: 0 12px 32px rgba(11, 18, 32, 0.28);
}
.balance-card::after {
  content: "";
  position: absolute;
  right: -40px;
  top: -40px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(15, 169, 104, 0.5), transparent 70%);
}
.bal-top { display: flex; align-items: center; justify-content: space-between; position: relative; }
.bal-label { font-size: 13px; opacity: 0.85; }
.bal-badge { font-size: 11px; background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 999px; }
.bal-value { font-size: 40px; font-weight: 700; letter-spacing: -0.02em; margin: 10px 0 8px; position: relative; }
.bal-sub { font-size: 12px; opacity: 0.8; position: relative; }
.bal-sub b { font-weight: 600; }
.sep { margin: 0 6px; opacity: 0.5; }

.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.action {
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 4px 12px;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  box-shadow: var(--el-box-shadow-lighter);
  transition: transform var(--kb-base) var(--kb-ease), box-shadow var(--kb-base) var(--kb-ease);
}
.action:hover { transform: translateY(-2px); box-shadow: var(--el-box-shadow-light); }
.action:active { transform: scale(0.96); }
.action-icon { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
.list-card { border-radius: 14px; }
.list-head { display: flex; justify-content: space-between; align-items: center; }
.ledger-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.ledger-time { font-size: 12px; color: var(--el-text-color-placeholder); margin-top: 2px; }
.ledger-amt { font-weight: 600; }
.ledger-amt.in { color: #0c8a57; }
.ledger-amt.out { color: #dc2626; }
.empty { text-align: center; color: var(--el-text-color-placeholder); padding: 24px 0; }
.empty p { margin: 8px 0 0; font-size: 13px; }
</style>
