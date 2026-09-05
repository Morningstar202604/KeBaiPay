<template>
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
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FinanceOverview } from '@/types'
import { fetchFinanceOverview } from '@/api/modules'
import { extractError } from '@/api/http'
import { TOKEN_KEY } from '@/api/http'

const loading = ref(true)
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
    data.value = await fetchFinanceOverview()
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
