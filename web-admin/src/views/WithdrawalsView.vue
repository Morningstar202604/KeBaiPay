<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-select v-model="status" placeholder="全部状态" clearable style="width: 140px" @change="onSearch">
        <el-option label="待审核" value="PENDING" />
        <el-option label="已通过" value="APPROVED" />
        <el-option label="已拒绝" value="REJECTED" />
      </el-select>
      <el-button type="primary" @click="onSearch">查询</el-button>
    </div>
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="orderNo" label="提现单号" min-width="190" show-overflow-tooltip />
      <el-table-column label="用户" width="120">
        <template #default="{ row }">{{ row.user?.nickname || '-' }}</template>
      </el-table-column>
      <el-table-column label="金额" width="120">
        <template #default="{ row }">¥{{ row.amountYuan || (row.amount / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="tagType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="申请时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <template v-if="row.status === 'PENDING'">
            <el-button link type="success" @click="approve(row)">通过</el-button>
            <el-button link type="danger" @click="reject(row)">拒绝</el-button>
          </template>
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
import type { AdminWithdrawal } from '@/types'
import { fetchWithdrawals, approveWithdrawal, rejectWithdrawal } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<AdminWithdrawal[]>([])
const total = ref(0)
const loading = ref(true)
const status = ref('')
const query = reactive({ status: '', page: 1, limit: 15 })

function statusText(s: string) {
  const map: Record<string, string> = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已拒绝' }
  return map[s] || s
}
function tagType(s: string) {
  const map: Record<string, 'info' | 'success' | 'danger' | 'warning'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' }
  return map[s] || 'info'
}

async function load() {
  loading.value = true
  try {
    const res = await fetchWithdrawals({ status: query.status, page: query.page, limit: query.limit })
    list.value = res.data
    total.value = res.total
  } catch (e) { ElMessage.error(extractError(e)) } finally { loading.value = false }
}

function onSearch() { query.status = status.value; query.page = 1; load() }
function onPage(p: number) { query.page = p; load() }

async function approve(row: AdminWithdrawal) {
  try {
    await ElMessageBox.confirm('确定通过该提现并打款？', '提示', { type: 'warning' })
  } catch {
    return
  }
  try {
    await approveWithdrawal(row.id)
    ElMessage.success('已通过')
    load()
  } catch (e) { ElMessage.error(extractError(e)) }
}

async function reject(row: AdminWithdrawal) {
  let reason = ''
  try {
    const r = await ElMessageBox.prompt('请输入拒绝原因', '拒绝提现', { inputPattern: /\S+/, inputErrorMessage: '请填写原因' })
    reason = r.value
  } catch {
    return
  }
  try {
    await rejectWithdrawal(row.id, reason)
    ElMessage.success('已拒绝')
    load()
  } catch (e) { ElMessage.error(extractError(e)) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
