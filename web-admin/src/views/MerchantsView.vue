<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-select v-model="status" placeholder="全部状态" clearable style="width: 140px" @change="onSearch">
        <el-option label="待审核" value="PENDING" />
        <el-option label="已通过" value="APPROVED" />
        <el-option label="已驳回" value="REJECTED" />
      </el-select>
      <el-button type="primary" @click="onSearch">查询</el-button>
    </div>
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="merchantNo" label="商户号" width="190" show-overflow-tooltip />
      <el-table-column prop="merchantName" label="商户名称" min-width="140" />
      <el-table-column label="申请人" width="110">
        <template #default="{ row }">{{ row.user?.nickname || '-' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="tagType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="费率" width="90">
        <template #default="{ row }">{{ row.payRate != null ? (row.payRate / 100).toFixed(2) + '%' : '-' }}</template>
      </el-table-column>
      <el-table-column prop="createdAt" label="申请时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <template v-if="row.status === 'PENDING'">
            <el-button link type="success" @click="audit(row, 'APPROVE')">通过</el-button>
            <el-button link type="danger" @click="audit(row, 'REJECT')">驳回</el-button>
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
import type { AdminMerchant } from '@/types'
import { fetchMerchants, auditMerchant } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<AdminMerchant[]>([])
const total = ref(0)
const loading = ref(true)
const status = ref('')
const query = reactive({ status: '', page: 1, limit: 15 })

function statusText(s: string) {
  const map: Record<string, string> = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已驳回', SUSPENDED: '已停用' }
  return map[s] || s
}
function tagType(s: string) {
  const map: Record<string, 'info' | 'success' | 'danger' | 'warning'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', SUSPENDED: 'info' }
  return map[s] || 'info'
}

async function load() {
  loading.value = true
  try {
    const res = await fetchMerchants({ status: query.status, page: query.page, limit: query.limit })
    list.value = res.data
    total.value = res.total
  } catch (e) { ElMessage.error(extractError(e)) } finally { loading.value = false }
}

function onSearch() { query.status = status.value; query.page = 1; load() }
function onPage(p: number) { query.page = p; load() }

async function audit(row: AdminMerchant, action: 'APPROVE' | 'REJECT') {
  let reason: string | undefined
  try {
    if (action === 'REJECT') {
      const r = await ElMessageBox.prompt('请输入驳回原因', '驳回商户', { inputPattern: /\S+/, inputErrorMessage: '请填写驳回原因' })
      reason = r.value
    } else {
      await ElMessageBox.confirm(`确定通过商户「${row.merchantName}」？`, '提示', { type: 'warning' })
    }
  } catch {
    // 用户取消弹窗：直接返回，避免未处理的 rejection
    return
  }
  try {
    await auditMerchant(row.id, { action, reason })
    ElMessage.success(action === 'APPROVE' ? '已通过' : '已驳回')
    load()
  } catch (e) { ElMessage.error(extractError(e)) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
