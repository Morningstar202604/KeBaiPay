<template>
  <div>
    <el-segmented v-model="direction" :options="opts" block style="margin-bottom: 12px" @change="load" />
    <el-card shadow="never" class="card">
      <el-skeleton v-if="loading" :rows="6" animated />
      <div v-else-if="list.length === 0" class="empty">暂无账单</div>
      <div v-for="g in groups" :key="g.date" class="day-group">
        <div class="day-head">{{ g.date }}<span class="day-sum">{{ g.items.length }} 笔 · 合计 ¥{{ g.total.toFixed(2) }}</span></div>
        <div v-for="b in g.items" :key="b.id" class="row">
          <div>
            <div>{{ b.subject || '收单订单' }} · {{ b.orderNo }}</div>
            <div class="sub">{{ statusText(b.status) }} · {{ fmt(b.createdAt).slice(11) }}</div>
          </div>
          <div class="amt out">-¥{{ b.amountYuan }}</div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { BillItem } from '@/types'
import { fetchBills } from '@/api/modules'
import { extractError } from '@/api/http'

const direction = ref<'ALL' | 'EXPENSE'>('ALL')
const opts = [
  { label: '全部', value: 'ALL' },
  { label: '已支付/已退款', value: 'EXPENSE' },
]
const list = ref<BillItem[]>([])
const loading = ref(true)

const groups = computed(() => {
  const map = new Map<string, { date: string; total: number; items: BillItem[] }>()
  for (const b of list.value) {
    const date = (b.createdAt || '').slice(0, 10)
    if (!map.has(date)) map.set(date, { date, total: 0, items: [] })
    const g = map.get(date)!
    g.items.push(b)
    g.total += Number(b.amountYuan) || 0
  }
  return [...map.values()]
})

function statusText(s: string) {
  const map: Record<string, string> = { PENDING: '待支付', PAID: '已支付', CLOSED: '已关闭', REFUNDED: '已退款' }
  return map[s] || s
}
function fmt(v: string) {
  return v ? v.replace('T', ' ').slice(0, 16) : ''
}

async function load() {
  loading.value = true
  try {
    list.value = await fetchBills({
      direction: direction.value === 'EXPENSE' ? 'EXPENSE' : undefined,
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
.amt.out { color: #ef4444; }
.empty { color: #9ca3af; text-align: center; padding: 24px; font-size: 13px; }
.day-group { margin-bottom: 8px; }
.day-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--el-text-color-secondary); padding: 8px 0 4px; border-bottom: 1px solid var(--el-border-color-lighter); position: sticky; top: 0; background: #fff; z-index: 1; }
.day-sum { font-variant-numeric: tabular-nums; }
</style>
