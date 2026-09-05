<template>
  <div>
    <div class="page-head">
      <div class="page-title">数据概览</div>
      <div class="page-sub">科佰支付平台关键运营指标</div>
    </div>

    <el-row :gutter="16">
      <el-col v-for="c in cards" :key="c.label" :span="4" style="min-width: 200px">
        <div class="metric" :class="{ clickable: !!c.to }" role="button" @click="c.to && router.push(c.to)">
          <div class="metric-icon" :style="{ background: c.bg, color: c.color }">
            <el-icon :size="20"><component :is="c.icon" /></el-icon>
          </div>
          <div class="metric-body">
            <div class="metric-num num">{{ fmtCount(c.value) }}</div>
            <div class="metric-label">{{ c.label }}</div>
          </div>
          <el-icon v-if="c.to" class="metric-arrow"><ArrowRight /></el-icon>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Shop, List, Money, Warning, ArrowRight } from '@element-plus/icons-vue'
import type { DashboardStats } from '@/types'
import { fetchDashboard } from '@/api/modules'
import { extractError } from '@/api/http'

const router = useRouter()
const stats = ref<DashboardStats | null>(null)

// 千分位展示（P0-3）
function fmtCount(n: number): string {
  return Number(n || 0).toLocaleString('en-US')
}

const cards = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: '用户总数', value: s.totalUsers, icon: User, bg: '#e6f7f0', color: '#0c8a57', to: '/users' },
    { label: '商户总数', value: s.totalMerchants, icon: Shop, bg: '#e0f2fe', color: '#0369a1', to: '/merchants' },
    { label: '今日订单', value: s.todayOrders, icon: List, bg: '#fef3c7', color: '#b45309', to: '/orders' },
    { label: '待处理提现', value: s.pendingWithdrawals, icon: Money, bg: '#ede9fe', color: '#6d28d9', to: '/withdrawals' },
    { label: '待审核商户', value: s.pendingMerchants, icon: Warning, bg: '#fee2e2', color: '#b91c1c', to: '/merchants' },
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
.page-head { margin-bottom: 20px; }
.metric {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  padding: 20px;
  box-shadow: var(--el-box-shadow-light);
  transition: box-shadow var(--kb-base) var(--kb-ease), transform var(--kb-base) var(--kb-ease);
}
.metric:hover { transform: translateY(-2px); box-shadow: var(--el-box-shadow-dark); }
.metric.clickable { cursor: pointer; }
.metric-arrow { margin-left: auto; color: var(--el-text-color-placeholder); transition: transform var(--kb-base) var(--kb-ease); }
.metric.clickable:hover .metric-arrow { transform: translateX(3px); color: var(--el-color-primary); }
.metric-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.metric-num { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: var(--el-text-color-primary); }
.metric-label { font-size: 13px; color: var(--el-text-color-secondary); margin-top: 2px; }
</style>
