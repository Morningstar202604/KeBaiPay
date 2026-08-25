<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-select v-model="level" placeholder="全部级别" clearable style="width: 130px" @change="onSearch">
        <el-option label="低" value="LOW" />
        <el-option label="中" value="MEDIUM" />
        <el-option label="高" value="HIGH" />
      </el-select>
      <el-select v-model="handledFilter" placeholder="全部状态" clearable style="width: 130px" @change="onSearch">
        <el-option label="待处置" value="false" />
        <el-option label="已处置" value="true" />
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
        <template #default="{ row }">
          <el-tag v-if="row.handled" type="success">已处置</el-tag>
          <el-tag v-else type="danger">待处置</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
      <el-table-column prop="userId" label="用户ID" min-width="180" show-overflow-tooltip />
      <el-table-column prop="createdAt" label="时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110">
        <template #default="{ row }">
          <el-button v-if="!row.handled" link type="primary" @click="handle(row)">处置</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.limit" :current-page="query.page" @current-change="onPage" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { fmt } from '@/utils/format'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { RiskEvent } from '@/types'
import { fetchRiskEvents, handleRiskEvent } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<RiskEvent[]>([])
const total = ref(0)
const loading = ref(true)
const level = ref('')
const handledFilter = ref('')
const query = reactive({ level: '', handled: '', page: 1, limit: 15 })


async function load() {
  loading.value = true
  try {
    const res = await fetchRiskEvents({
      level: query.level,
      handled: query.handled === '' ? undefined : query.handled,
      page: query.page,
      limit: query.limit,
    })
    list.value = res.data
    total.value = res.total
  } catch (e) { ElMessage.error(extractError(e)) } finally { loading.value = false }
}

function onSearch() { query.level = level.value; query.handled = handledFilter.value; query.page = 1; load() }
function onPage(p: number) { query.page = p; load() }

async function handle(row: RiskEvent) {
  let note: string | null = null
  try {
    const r = await ElMessageBox.prompt('请输入处置说明', '处置风控事件', { inputPattern: /\S+/, inputErrorMessage: '请填写说明' })
    note = r.value
  } catch {
    // 用户取消弹窗：直接返回，不报"网络错误"
    return
  }
  try {
    await handleRiskEvent(row.id, { note })
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
