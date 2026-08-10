<template>
  <el-card shadow="never">
    <template #header>财务总览</template>
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

const loading = ref(true)
const data = ref<FinanceOverview | null>(null)

const fields = computed<Record<string, string>>(() => {
  const d = data.value || {}
  return {
    总交易额: `¥${d.totalTurnoverYuan ?? '0.00'}`,
    总收入: `¥${d.totalIncomeYuan ?? '0.00'}`,
    总支出: `¥${d.totalExpenseYuan ?? '0.00'}`,
    手续费: `¥${d.totalFeeYuan ?? '0.00'}`,
    净收入: `¥${d.netIncomeYuan ?? '0.00'}`,
    总资产: `¥${d.totalAssets ?? '0.00'}`,
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
