<template>
  <div>
    <el-card shadow="never" style="margin-bottom: 16px">
      <div class="toolbar">
        <el-date-picker
          v-model="range"
          type="daterange"
        :shortcuts="rangeShortcuts"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
        />
        <el-button type="primary" :loading="loading" @click="load">查询对账</el-button>
      </div>
    </el-card>

    <el-row v-if="summary" :gutter="16" style="margin-bottom: 16px">
      <el-col :span="8">
        <el-card shadow="hover"><div class="mini-label">订单数</div><div class="mini-val">{{ summary.count }}</div></el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover"><div class="mini-label">交易总额</div><div class="mini-val">¥ {{ summary.amountYuan }}</div></el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover"><div class="mini-label">净收入</div><div class="mini-val">¥ {{ summary.netYuan }}</div></el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="date" label="日期" width="140" />
        <el-table-column label="订单数" prop="count" width="120" />
        <el-table-column label="交易额">
          <template #default="{ row }">¥ {{ row.amountYuan }}</template>
        </el-table-column>
        <el-table-column label="手续费">
          <template #default="{ row }">¥ {{ row.feeYuan }}</template>
        </el-table-column>
        <el-table-column label="净收入">
          <template #default="{ row }">¥ {{ row.netYuan }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { ReconciliationData } from '@/types'
import { fetchReconciliation } from '@/api/modules'
import { extractError } from '@/api/http'

const range = ref<[string, string] | null>(null)

// 快捷日期范围（近7天/近30天）
const rangeShortcuts = [
  { text: '近7天', value: () => { const e = new Date(); const s2 = new Date(Date.now() - 7 * 864e5); return [s2, e] } },
  { text: '近30天', value: () => { const e = new Date(); const s2 = new Date(Date.now() - 30 * 864e5); return [s2, e] } },
]
const loading = ref(false)
const data = ref<ReconciliationData | null>(null)

const rows = computed(() => data.value?.data || [])
const summary = computed(() => data.value?.summary || null)

async function load() {
  loading.value = true
  try {
    data.value = await fetchReconciliation({
      startDate: range.value?.[0],
      endDate: range.value?.[1],
    })
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
}
.mini-label {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 6px;
}
.mini-val {
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
}
</style>
