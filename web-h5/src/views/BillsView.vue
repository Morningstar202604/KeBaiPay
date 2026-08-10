<template>
  <div>
    <el-segmented v-model="direction" :options="opts" block style="margin-bottom: 12px" @change="load" />
    <el-card shadow="never" class="card">
      <el-skeleton v-if="loading" :rows="6" animated />
      <div v-else-if="list.length === 0" class="empty">暂无账单</div>
      <div v-for="b in list" :key="b.id" class="row">
        <div>
          <div>{{ typeText(b.type) }} {{ b.direction === 'INCOME' ? '（收）' : '（付）' }}</div>
          <div class="sub">{{ fmt(b.createdAt) }} · {{ b.counterparty || '' }} {{ b.remark || '' }}</div>
        </div>
        <div :class="['amt', b.direction === 'INCOME' ? 'in' : 'out']">
          {{ b.direction === 'INCOME' ? '+' : '-' }}¥{{ b.amountYuan }}
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

const direction = ref<'ALL' | 'INCOME' | 'EXPENSE'>('ALL')
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
</style>
