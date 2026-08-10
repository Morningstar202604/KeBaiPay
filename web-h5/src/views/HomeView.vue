<template>
  <div>
    <div class="balance-card">
      <div class="balance-label">账户总余额（元）</div>
      <div class="balance-value">{{ account?.totalBalanceYuan || '0.00' }}</div>
      <div class="balance-sub">
        可用 ¥{{ account?.availableBalanceYuan || '0.00' }} · 冻结 ¥{{ account?.frozenBalanceYuan || '0.00' }}
      </div>
    </div>

    <div class="grid">
      <div v-for="a in actions" :key="a.to" class="action" @click="$router.push(a.to)">
        <el-icon :size="22" :color="a.color"><component :is="a.icon" /></el-icon>
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
      <div v-else-if="ledgers.length === 0" class="empty">暂无账单</div>
      <div v-for="l in ledgers.slice(0, 6)" :key="l.id" class="ledger-row">
        <div class="ledger-left">
          <div>{{ typeText(l.type) }}</div>
          <div class="ledger-time">{{ fmt(l.createdAt) }}</div>
        </div>
        <div :class="['ledger-amt', l.direction === 'INCOME' ? 'in' : 'out']">
          {{ l.direction === 'INCOME' ? '+' : '-' }}¥{{ l.amountYuan }}
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Refresh, Download, Present, Money, List } from '@element-plus/icons-vue'
import type { AccountInfo, LedgerItem } from '@/types'
import { fetchAccount } from '@/api/modules'
import { extractError } from '@/api/http'

const account = ref<AccountInfo | null>(null)
const loading = ref(true)
const ledgers = ref<LedgerItem[]>([])

const actions = [
  { to: '/recharge', label: '充值', icon: Plus, color: '#10b981' },
  { to: '/transfer', label: '转账', icon: Refresh, color: '#0ea5e9' },
  { to: '/withdraw', label: '提现', icon: Download, color: '#f59e0b' },
  { to: '/redpacket', label: '红包', icon: Present, color: '#ef4444' },
]

function typeText(t: string) {
  const map: Record<string, string> = {
    RECHARGE: '充值', TRANSFER: '转账', WITHDRAW: '提现',
    RED_PACKET: '红包', PAYMENT: '付款', REFUND: '退款', FEE: '手续费',
    ADJUSTMENT: '调账', ESCROW: '担保', ESCROW_RELEASE: '担保解冻',
    ESCROW_REFUND: '担保退款', BATCH_TRANSFER: '批量转账', SUBSCRIPTION: '订阅',
    REFERRAL_REWARD: '邀请奖励',
  }
  return map[t] || t
}
function fmt(v: string) {
  return v ? v.replace('T', ' ').slice(5, 16) : ''
}

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
  background: linear-gradient(135deg, #10b981, #0ea5e9);
  border-radius: 12px;
  color: #fff;
  padding: 20px;
  margin-bottom: 12px;
}
.balance-label { font-size: 13px; opacity: 0.9; }
.balance-value { font-size: 34px; font-weight: 700; margin: 6px 0; }
.balance-sub { font-size: 12px; opacity: 0.9; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.action { background: #fff; border-radius: 10px; display: flex; flex-direction: column; align-items: center; padding: 16px 4px; gap: 6px; font-size: 12px; color: #374151; }
.list-card { border-radius: 10px; }
.list-head { display: flex; justify-content: space-between; align-items: center; }
.ledger-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
.ledger-time { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.ledger-amt { font-weight: 600; }
.ledger-amt.in { color: #10b981; }
.ledger-amt.out { color: #ef4444; }
.empty { text-align: center; color: #9ca3af; padding: 20px 0; }
</style>
