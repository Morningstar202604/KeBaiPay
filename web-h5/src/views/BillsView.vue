<template>
  <div>
    <el-segmented v-model="direction" :options="opts" block style="margin-bottom: 12px" @change="load" />
    <el-card shadow="never" class="card">
      <el-skeleton v-if="loading" :rows="6" animated />
      <div v-else-if="list.length === 0" class="empty">暂无账单</div>
      <div v-for="g in groups" :key="g.date" class="day-group">
        <div class="day-head">{{ g.date }}<span class="day-sum">收 ¥{{ g.income }} · 支 ¥{{ g.expense }}</span></div>
        <div v-for="b in g.items" :key="b.id" class="row">
          <div>
            <div>{{ typeText(b.type) }} {{ b.direction === 'INCOME' ? '（收）' : '（付）' }}</div>
            <div class="sub">{{ fmt(b.createdAt).slice(11) }} · {{ b.counterparty || '' }} {{ b.remark || '' }}</div>
          </div>
          <div :class="['amt', b.direction === 'INCOME' ? 'in' : 'out']">
            {{ b.direction === 'INCOME' ? '+' : '-' }}¥{{ b.amountYuan }}
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { BillItem } from '@/types'
import { fetchBills } from '@/api/modules'
import { extractError } from '@/api/http'

import { computed } from 'vue'
const direction = ref<'ALL' | 'INCOME' | 'EXPENSE'>('ALL')
// 按日分组（P1-22）：日期头 + 当日收/支小计
const groups = computed(() => {
  const map = new Map<string, { date: string; income: number; expense: number; items: BillItem[] }>()
  for (const b of list.value) {
    const date = (b.createdAt || '').slice(0, 10)
    if (!map.has(date)) map.set(date, { date, income: 0, expense: 0, items: [] })
    const g = map.get(date)!
    g.items.push(b)
    const amt = Number(b.amountYuan) || 0
    if (b.direction === 'INCOME') g.income += amt
    else g.expense += amt
  }
  return [...map.values()]
})

const opts = [
  { label: '全部', value: 'ALL' },
  { label: '收入', value: 'INCOME' },
  { label: '支出', value: 'EXPENSE' },
]
const list = ref<BillItem[]>([])
const loading = ref(true)

function typeText(t: string) {
  const map: Record<string, string> = {
    RECHARGE: '充值', TRANSFER: '转账', WITHDRAW: '提现',
    RED_PACKET: '红包', RECEIPT: '收款', PAYMENT: '付款',
    REFUND: '退款', SUBSCRIPTION: '订阅', REFERRAL_REWARD: '邀请奖励',
    ESCROW: '担保', ESCROW_INCOME: '担保收款', ESCROW_REFUND: '担保退款',
  }
  return map[t] || t
}
function fmt(v: string) {
  return v ? v.replace('T', ' ').slice(0, 16) : ''
}

async function load() {
  loading.value = true
  try {
    list.value = await fetchBills({
      direction: direction.value === 'ALL' ? undefined : direction.value,
    })
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.card { border-radius: 10px; }
.row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
.sub { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.amt { font-weight: 600; }
.amt.in { color: #10b981; }
.amt.out { color: #ef4444; }
.empty { color: #9ca3af; text-align: center; padding: 24px; font-size: 13px; }
  .day-group { margin-bottom: 8px; }
  .day-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--el-text-color-secondary); padding: 8px 0 4px; border-bottom: 1px solid var(--el-border-color-lighter); position: sticky; top: 0; background: #fff; z-index: 1; }
  .day-sum { font-variant-numeric: tabular-nums; }
</style>
