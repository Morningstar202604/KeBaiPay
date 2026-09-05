<template>
  <div>
  <el-card shadow="never">
    <template #header>
      <div class="finance-head">
        <span>财务总览</span>
        <div class="finance-export">
          <el-button size="small" :loading="exporting === 'daily-summary'" @click="exportCsv('daily-summary', '每日汇总')">导出每日汇总 CSV</el-button>
          <el-button size="small" :loading="exporting === 'merchant-settlements'" @click="exportCsv('merchant-settlements', '商户结算')">导出商户结算 CSV</el-button>
        </div>
      </div>
    </template>
    <el-skeleton v-if="loading" :rows="4" animated />
    <el-descriptions v-else :column="2" border>
      <el-descriptions-item v-for="(v, k) in fields" :key="k" :label="k">{{ v }}</el-descriptions-item>
    </el-descriptions>
  </el-card>

  <el-card shadow="never" class="chart-card">
    <template #header>近 7 日收支（元）</template>
    <div class="chart" v-if="chartBars.length">
      <div class="chart-row" v-for="b in chartBars" :key="b.date">
        <span class="chart-date">{{ b.date }}</span>
        <div class="chart-bars">
          <div class="bar income" :style="{ height: b.incomeH + 'px' }" :title="'收入 ¥' + b.income.toFixed(2)"></div>
          <div class="bar expense" :style="{ height: b.expenseH + 'px' }" :title="'支出 ¥' + b.expense.toFixed(2)"></div>
        </div>
      </div>
      <div class="chart-legend">
        <span><i class="dot income"></i>收入</span>
        <span><i class="dot expense"></i>支出</span>
      </div>
    </div>
    <el-empty v-else description="暂无数据" :image-size="60" />
  </el-card>
</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FinanceOverview } from '@/types'
import { fetchFinanceOverview, fetchDailySummary, type DailySummaryItem } from '@/api/modules'
import { extractError } from '@/api/http'
import { TOKEN_KEY } from '@/api/http'

const loading = ref(true)
const chartData = ref<DailySummaryItem[]>([])

// 近 7 日柱图几何：按收入/支出归一化高度（纯 SVG，无图表库依赖）
const chartBars = computed(() => {
  const days = chartData.value
  if (!days.length) return []
  const max = Math.max(...days.map((d) => Math.max(Number(d.totalIncomeYuan), Number(d.totalExpenseYuan)), 1))
  return days.map((d) => {
    const income = Number(d.totalIncomeYuan)
    const expense = Number(d.totalExpenseYuan)
    const scale = (v: number) => Math.max(2, Math.round((v / max) * 90))
    return {
      date: d.date.slice(5),
      incomeH: scale(income),
      expenseH: scale(expense),
      income,
      expense,
    }
  })
})
const data = ref<FinanceOverview | null>(null)
const exporting = ref<'' | 'daily-summary' | 'merchant-settlements'>('')

// CSV 导出：带鉴权头拉取 blob 后触发浏览器下载
async function exportCsv(kind: 'daily-summary' | 'merchant-settlements', filename: string) {
  exporting.value = kind
  try {
    const res = await fetch(`/admin/finance/${kind}/export`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) || ''}` },
    })
    if (!res.ok) throw new Error(`导出失败（HTTP ${res.status}）`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename + '.csv'
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = ''
  }
}

const fields = computed<Record<string, string>>(() => {
  const d = data.value || {}
  return {
    总交易额: `¥${d.totalTurnoverYuan ?? '0.00'}`,
    总收入: `¥${d.totalIncomeYuan ?? '0.00'}`,
    总支出: `¥${d.totalExpenseYuan ?? '0.00'}`,
    手续费: `¥${d.totalFeeYuan ?? '0.00'}`,
    净收入: `¥${d.netIncomeYuan ?? '0.00'}`,
    总资产: `¥${d.totalAssetsYuan ?? '0.00'}`,
    交易笔数: `${d.transactionCount ?? 0}`,
  }
})

onMounted(async () => {
  try {
    const [overview, daily] = await Promise.all([
      fetchFinanceOverview(),
      fetchDailySummary({ startDate: new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10) }),
    ])
    data.value = overview
    chartData.value = (daily.data || []).slice(-7)
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.finance-head { display: flex; align-items: center; justify-content: space-between; }
.finance-export { display: flex; gap: 8px; }
</style>

<style scoped>
.finance-head { display: flex; align-items: center; justify-content: space-between; }
.finance-export { display: flex; gap: 8px; }
.chart-card { margin-top: 16px; }
.chart { display: flex; align-items: flex-end; gap: 18px; overflow-x: auto; padding: 8px 4px 0; }
.chart-row { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 52px; }
.chart-date { font-size: 12px; color: var(--el-text-color-secondary); }
.chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 92px; }
.bar { width: 14px; border-radius: 4px 4px 0 0; }
.bar.income { background: var(--el-color-primary); }
.bar.expense { background: #f59e0b; }
.chart-legend { display: flex; gap: 16px; font-size: 12px; color: var(--el-text-color-secondary); margin-top: 8px; }
.chart-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
.chart-legend .dot.income { background: var(--el-color-primary); }
.chart-legend .dot.expense { background: #f59e0b; }
</style>
