<template>
  <div>
    <div class="summary-card">
      <div class="sum-top">
        <span class="sum-label">收单服务</span>
        <span class="sum-badge">科佰收单</span>
      </div>
      <div class="sum-value num">{{ stats.totalYuan }}</div>
      <div class="sum-sub">
        累计收单 <b>{{ stats.count }}</b> 笔
        <span class="sep">·</span>
        平台不代收资金，款项由持牌支付通道直接清算
      </div>
    </div>

    <div class="grid">
      <div v-for="a in actions" :key="a.to" class="action" @click="$router.push(a.to)">
        <span class="action-icon" :style="{ background: a.bg, color: a.color }">
          <el-icon :size="20"><component :is="a.icon" /></el-icon>
        </span>
        <span>{{ a.label }}</span>
      </div>
    </div>

    <el-card shadow="never" class="list-card">
      <template #header>
        <div class="list-head">
          <span>最近账单</span>
          <el-button link type="primary" @click="$router.push('/bills')">全部</el-button>
        </div>
      </template>
      <el-skeleton v-if="loading" :rows="4" animated />
      <div v-else-if="ledgers.length === 0" class="empty">
        <el-icon size="28"><List /></el-icon>
        <p>暂无账单记录</p>
      </div>
      <div v-for="l in ledgers.slice(0, 6)" :key="l.orderNo" class="ledger-row">
        <div class="ledger-left">
          <div>{{ l.subject || '收单订单' }}</div>
          <div class="ledger-time">{{ fmt(l.createdAt) }}</div>
        </div>
        <div class="ledger-amt num">
          -¥{{ l.amountYuan }}
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Money, List, MagicStick, Postcard } from '@element-plus/icons-vue'
import type { BillItem } from '@/types'
import { fetchBills } from '@/api/modules'
import { extractError } from '@/api/http'

const loading = ref(true)
const ledgers = ref<BillItem[]>([])
const stats = computed(() => {
  const total = ledgers.value.reduce((sum, l) => sum + (Number(l.amountYuan) || 0), 0)
  return { totalYuan: total.toFixed(2), count: ledgers.value.length }
})

const actions = [
  { to: '/cashier', label: '收银台', icon: Money, bg: '#e6f7f0', color: '#0c8a57' },
  { to: '/bills', label: '账单', icon: List, bg: '#e0f2fe', color: '#0369a1' },
  { to: '/agent', label: 'AI助手', icon: MagicStick, bg: '#f3e8ff', color: '#7c3aed' },
  { to: '/kyc', label: '实名认证', icon: Postcard, bg: '#fef3c7', color: '#b45309' },
]

function fmt(v: string) { return v ? v.replace('T', ' ').slice(5, 16) : '' }

onMounted(async () => {
  try {
    ledgers.value = await fetchBills()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.summary-card {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(120% 120% at 0% 0%, rgba(255, 255, 255, 0.16), transparent 55%),
    linear-gradient(135deg, #0b1220, #0f1a2e 55%, #12334a);
  border-radius: 18px;
  color: #fff;
  padding: 22px 20px;
  margin-bottom: 14px;
  box-shadow: 0 12px 32px rgba(11, 18, 32, 0.28);
}
.summary-card::after {
  content: "";
  position: absolute;
  right: -40px;
  top: -40px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(15, 169, 104, 0.5), transparent 70%);
}
.sum-top { display: flex; align-items: center; justify-content: space-between; position: relative; }
.sum-label { font-size: 13px; opacity: 0.85; }
.sum-badge { font-size: 11px; background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 999px; }
.sum-value { font-size: 40px; font-weight: 700; letter-spacing: -0.02em; margin: 10px 0 8px; position: relative; }
.sum-sub { font-size: 12px; opacity: 0.8; position: relative; }
.sum-sub b { font-weight: 600; }
.sep { margin: 0 6px; opacity: 0.5; }

.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.action {
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 4px 12px;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  box-shadow: var(--el-box-shadow-lighter);
  transition: transform var(--kb-base) var(--kb-ease), box-shadow var(--kb-base) var(--kb-ease);
}
.action:hover { transform: translateY(-2px); box-shadow: var(--el-box-shadow-light); }
.action:active { transform: scale(0.96); }
.action-icon { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
.list-card { border-radius: 14px; }
.list-head { display: flex; justify-content: space-between; align-items: center; }
.ledger-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.ledger-time { font-size: 12px; color: var(--el-text-color-placeholder); margin-top: 2px; }
.ledger-amt { font-weight: 600; color: #dc2626; }
.empty { text-align: center; color: var(--el-text-color-placeholder); padding: 24px 0; }
.empty p { margin: 8px 0 0; font-size: 13px; }
</style>
