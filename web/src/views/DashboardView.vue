<template>
  <div>
    <el-alert
      v-if="merchant && merchant.status !== 'APPROVED'"
      :title="`商户状态：${statusText(merchant.status)}，商户审核通过后即可查看经营数据。`"
      type="warning"
      :closable="false"
      style="margin-bottom: 16px"
    />

    <el-row :gutter="16">
      <el-col v-for="p in periods" :key="p.key" :span="8">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">{{ p.label }}</div>
          <div class="stat-count">{{ p.value.count }} 笔</div>
          <div class="stat-amount">
            <span class="amount">¥ {{ p.value.amountYuan }}</span>
          </div>
          <div class="stat-sub">
            手续费 ¥ {{ p.value.feeYuan }} · 净收入 ¥ {{ p.value.netYuan }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" style="margin-top: 16px">
      <template #header>
        <span>交易规模对比</span>
      </template>
      <div ref="chartEl" class="chart" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import * as echarts from 'echarts'
import type { DashboardData, MerchantInfo } from '@/types'
import { fetchDashboard, fetchMerchantInfo } from '@/api/modules'
import { extractError } from '@/api/http'
import { ElMessage } from 'element-plus'

const dashboard = ref<DashboardData | null>(null)
const merchant = ref<MerchantInfo | null>(null)
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
  const map: Record<string, string> = {
    PENDING: '待审核',
    APPROVED: '已通过',
    REJECTED: '已驳回',
    SUSPENDED: '已停用',
  }
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
    tooltip: { trigger: 'axis' },
    legend: { data: ['交易额', '净收入'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: keys.map((k) => k.label) },
    yAxis: { type: 'value', name: '元' },
    series: [
      {
        name: '交易额',
        type: 'bar',
        data: keys.map((k) => Number(d[k.key].amountYuan)),
        itemStyle: { color: '#10b981' },
        barWidth: 40,
      },
      {
        name: '净收入',
        type: 'bar',
        data: keys.map((k) => Number(d[k.key].netYuan)),
        itemStyle: { color: '#0ea5e9' },
        barWidth: 40,
      },
    ],
  })
}

function onResize() {
  chart?.resize()
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  try {
    const [d, m] = await Promise.all([fetchDashboard(), fetchMerchantInfo()])
    dashboard.value = d
    merchant.value = m
    renderChart()
  } catch (e) {
    ElMessage.error(extractError(e))
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
})
</script>

<style scoped>
.stat-card {
  border-radius: 8px;
}
.stat-label {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 8px;
}
.stat-count {
  font-size: 14px;
  color: #374151;
  margin-bottom: 6px;
}
.stat-amount .amount {
  font-size: 26px;
  font-weight: 700;
  color: #1f2937;
}
.stat-sub {
  margin-top: 8px;
  font-size: 12px;
  color: #9ca3af;
}
.chart {
  height: 320px;
}
</style>
