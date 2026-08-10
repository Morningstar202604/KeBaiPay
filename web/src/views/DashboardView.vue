<template>
  <div class="dash">
    <el-alert
      v-if="noMerchant"
      title="您尚未入驻商户，完成入驻后可查看经营数据。"
      type="warning"
      :closable="false"
      style="margin-bottom: 16px"
    >
      <template #default>
        <el-button type="primary" size="small" @click="$router.push('/merchant/register')">去入驻申请</el-button>
      </template>
    </el-alert>
    <el-alert
      v-else-if="merchant && merchant.status !== 'APPROVED'"
      :title="`商户状态：${statusText(merchant.status)}，商户审核通过后即可查看经营数据。`"
      type="warning"
      :closable="false"
      style="margin-bottom: 16px"
    />

    <div v-if="dashboard" class="stat-row">
      <div v-for="p in periods" :key="p.key" class="stat-card">
        <div class="stat-head">
          <span class="stat-label">{{ p.label }}</span>
          <span class="stat-badge">{{ p.value.count }} 笔</span>
        </div>
        <div class="stat-amount num">¥ {{ p.value.amountYuan }}</div>
        <div class="stat-foot">
          <span>手续费 <b>¥{{ p.value.feeYuan }}</b></span>
          <span class="dot" />
          <span>净收入 <b class="net">¥{{ p.value.netYuan }}</b></span>
        </div>
      </div>
    </div>

    <el-card shadow="never" class="chart-card raise">
      <template #header>
        <div class="chart-head">
          <span>交易规模对比</span>
          <span class="chart-tip">交易额 / 净收入（元）</span>
        </div>
      </template>
      <div ref="chartEl" class="chart" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as echarts from 'echarts'
import type { DashboardData, MerchantInfo } from '@/types'
import { fetchDashboard, fetchMerchantInfo } from '@/api/modules'

const dashboard = ref<DashboardData | null>(null)
const merchant = ref<MerchantInfo | null>(null)
const noMerchant = ref(false)
const chartEl = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

const periods = computed(() => {
  const d = dashboard.value
  if (!d) return []
  return [
    { key: 'today', label: '今日', value: d.today },
    { key: 'week', label: '近 7 天', value: d.week },
    { key: 'month', label: '近 30 天', value: d.month },
  ]
})

function statusText(s: string) {
  const map: Record<string, string> = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已驳回', SUSPENDED: '已停用' }
  return map[s] || s
}

function renderChart() {
  if (!chartEl.value || !dashboard.value) return
  const d = dashboard.value
  const keys: Array<{ key: keyof DashboardData; label: string }> = [
    { key: 'today', label: '今日' },
    { key: 'week', label: '近 7 天' },
    { key: 'month', label: '近 30 天' },
  ]
  chart = echarts.init(chartEl.value)
  chart.setOption({
    tooltip: { trigger: 'axis', borderRadius: 10, padding: [10, 14] },
    legend: { data: ['交易额', '净收入'], right: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
    grid: { left: 48, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: keys.map((k) => k.label), axisLine: { lineStyle: { color: '#e5e7eb' } }, axisTick: { show: false }, axisLabel: { color: '#64748b' } },
    yAxis: { type: 'value', name: '元', nameTextStyle: { color: '#94a3b8' }, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#f0f1f3', type: 'dashed' } } },
    series: [
      {
        name: '交易额', type: 'bar', data: keys.map((k) => Number(d[k.key].amountYuan)),
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#2bc08b' }, { offset: 1, color: '#0fa968' }]), borderRadius: [8, 8, 0, 0] }, barWidth: 42,
      },
      {
        name: '净收入', type: 'bar', data: keys.map((k) => Number(d[k.key].netYuan)),
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#38bdf8' }, { offset: 1, color: '#0ea5e9' }]), borderRadius: [8, 8, 0, 0] }, barWidth: 42,
      },
    ],
  })
}

function onResize() { chart?.resize() }

onMounted(async () => {
  window.addEventListener('resize', onResize)
  try {
    const [d, m] = await Promise.all([fetchDashboard(), fetchMerchantInfo()])
    dashboard.value = d
    merchant.value = m
    noMerchant.value = false
    renderChart()
  } catch {
    noMerchant.value = true
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
})
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.stat-card {
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  padding: 20px;
  box-shadow: var(--el-box-shadow-light);
  transition: box-shadow var(--kb-base) var(--kb-ease), transform var(--kb-base) var(--kb-ease);
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--el-box-shadow-dark);
}
.stat-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.stat-label { font-size: 13px; color: var(--el-text-color-secondary); font-weight: 500; }
.stat-badge { font-size: 12px; color: #0c8a57; background: #e6f7f0; padding: 2px 10px; border-radius: 999px; font-weight: 600; }
.stat-amount { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; color: var(--el-text-color-primary); }
.stat-foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 12px; color: var(--el-text-color-placeholder); }
.stat-foot b { color: var(--el-text-color-secondary); font-weight: 600; }
.stat-foot b.net { color: #0c8a57; }
.stat-foot .dot { width: 3px; height: 3px; border-radius: 50%; background: #cbd5e1; }
.chart-card { border-radius: 16px; }
.chart-head { display: flex; align-items: center; justify-content: space-between; }
.chart-tip { font-size: 12px; color: var(--el-text-color-placeholder); font-weight: 400; }
.chart { height: 320px; }
</style>
