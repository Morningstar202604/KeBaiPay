<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-select v-model="level" placeholder="全部级别" clearable style="width: 130px" @change="onSearch">
        <el-option label="低" value="LOW" />
        <el-option label="中" value="MEDIUM" />
        <el-option label="高" value="HIGH" />
      </el-select>
      <el-button type="primary" @click="onSearch">查询</el-button>
    </div>
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="type" label="类型" width="160" />
      <el-table-column label="级别" width="90">
        <template #default="{ row }">
          <el-tag :type="row.level === 'HIGH' ? 'danger' : row.level === 'MEDIUM' ? 'warning' : 'info'">{{ row.level }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">{{ row.status }}</template>
      </el-table-column>
      <el-table-column prop="userId" label="用户ID" min-width="200" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110">
        <template #default="{ row }">
          <el-button v-if="row.status === 'PENDING'" link type="primary" @click="handle(row)">处置</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.limit" :current-page="query.page" @current-change="onPage" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { RiskEvent } from '@/types'
import { fetchRiskEvents, handleRiskEvent } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<RiskEvent[]>([])
const total = ref(0)
const loading = ref(true)
const level = ref('')
const query = reactive({ level: '', page: 1, limit: 15 })

function fmt(v: string) { return v ? v.replace('T', ' ').slice(0, 19) : '-' }

async function load() {
  loading.value = true
  try {
    const res = await fetchRiskEvents({ level: query.level, page: query.page, limit: query.limit })
    list.value = res.data
    total.value = res.total
  } catch (e) { ElMessage.error(extractError(e)) } finally { loading.value = false }
}

function onSearch() { query.level = level.value; query.page = 1; load() }
function onPage(p: number) { query.page = p; load() }

async function handle(row: RiskEvent) {
  const r = await ElMessageBox.prompt('请输入处置说明', '处置风控事件', { inputPattern: /\S+/, inputErrorMessage: '请填写说明' })
  try {
    await handleRiskEvent(row.id, { action: 'RESOLVED', note: r.value })
    ElMessage.success('已处置')
    load()
  } catch (e) { ElMessage.error(extractError(e)) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
