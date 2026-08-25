<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索昵称/手机号/邮箱" clearable style="width: 240px" @keyup.enter="onSearch" />
      <el-select v-model="status" placeholder="全部状态" clearable style="width: 140px" @change="onSearch">
        <el-option label="正常" value="ACTIVE" />
        <el-option label="冻结" value="FROZEN" />
      </el-select>
      <el-button type="primary" @click="onSearch">查询</el-button>
    </div>
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="nickname" label="昵称" min-width="120" />
      <el-table-column prop="phone" label="手机号" width="140" />
      <el-table-column prop="email" label="邮箱" min-width="160" />
      <el-table-column label="实名状态" width="110">
        <template #default="{ row }">
          <el-tag :type="row.realNameStatus === 'VERIFIED' ? 'success' : 'info'">{{ row.realNameStatus }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="账号状态" width="110">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'danger'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="注册时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110">
        <template #default="{ row }">
          <el-button v-if="row.status === 'ACTIVE'" link type="danger" @click="toggleStatus(row, 'FROZEN')">冻结</el-button>
          <el-button v-else link type="success" @click="toggleStatus(row, 'ACTIVE')">解冻</el-button>
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
import type { AdminUser } from '@/types'
import { fetchUsers, setUserStatus } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<AdminUser[]>([])
const total = ref(0)
const loading = ref(true)
const keyword = ref('')
const status = ref('')
const query = reactive({ keyword: '', status: '', page: 1, limit: 15 })


async function load() {
  loading.value = true
  try {
    const res = await fetchUsers({ keyword: query.keyword, status: query.status, page: query.page, limit: query.limit })
    list.value = res.data
    total.value = res.total
  } catch (e) { ElMessage.error(extractError(e)) } finally { loading.value = false }
}

function onSearch() { query.keyword = keyword.value; query.status = status.value; query.page = 1; load() }
function onPage(p: number) { query.page = p; load() }

async function toggleStatus(row: AdminUser, st: string) {
  try {
    await ElMessageBox.confirm(`确定${st === 'FROZEN' ? '冻结' : '解冻'}用户 ${row.nickname}？`, '提示', { type: 'warning' })
  } catch {
    return
  }
  try {
    await setUserStatus(row.id, { status: st })
    ElMessage.success('操作成功')
    load()
  } catch (e) { ElMessage.error(extractError(e)) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
