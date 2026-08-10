<template>
  <div>
    <el-row :gutter="16">
      <el-col v-for="c in cards" :key="c.label" :span="4" style="min-width: 180px">
        <el-card shadow="hover">
          <div class="num">{{ c.value }}</div>
          <div class="label">{{ c.label }}</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { DashboardStats } from '@/types'
import { fetchDashboard } from '@/api/modules'
import { extractError } from '@/api/http'

const stats = ref<DashboardStats | null>(null)

const cards = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: '用户总数', value: s.totalUsers },
    { label: '商户总数', value: s.totalMerchants },
    { label: '今日订单', value: s.todayOrders },
    { label: '待处理提现', value: s.pendingWithdrawals },
    { label: '待审核商户', value: s.pendingMerchants },
  ]
})

onMounted(async () => {
  try {
    stats.value = await fetchDashboard()
  } catch (e) {
    ElMessage.error(extractError(e))
  }
})
</script>

<style scoped>
.num { font-size: 30px; font-weight: 700; color: #1f2937; }
.label { margin-top: 6px; font-size: 13px; color: #6b7280; }
</style>
