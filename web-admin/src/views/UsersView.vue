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
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <el-button v-if="row.status === 'ACTIVE'" link type="danger" @click="toggleStatus(row, 'FROZEN')">冻结</el-button>
          <el-button v-else link type="success" @click="toggleStatus(row, 'ACTIVE')">解冻</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="query.limit" :current-page="query.page" @current-change="onPage" />
    </div>

    <el-drawer v-model="drawer" :title="`用户详情 · ${detail?.nickname || ''}`" size="420px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="detail-section">
            <div class="detail-title">基本信息</div>
            <div class="detail-row"><span>昵称</span><b>{{ detail.nickname }}</b></div>
            <div class="detail-row"><span>手机号</span><b>{{ detail.phone || '—' }}</b></div>
            <div class="detail-row"><span>邮箱</span><b>{{ detail.email || '—' }}</b></div>
            <div class="detail-row"><span>账号状态</span>
              <el-tag :type="detail.status === 'ACTIVE' ? 'success' : 'danger'" size="small">{{ detail.status }}</el-tag>
            </div>
            <div class="detail-row"><span>实名状态</span>
              <el-tag :type="detail.realNameStatus === 'VERIFIED' ? 'success' : 'info'" size="small">{{ detail.realNameStatus }}</el-tag>
            </div>
            <div class="detail-row"><span>注册时间</span><b>{{ fmt(detail.createdAt) }}</b></div>
          </div>
          <div class="detail-section" v-if="detail.account">
            <div class="detail-title">账户余额</div>
            <div class="detail-row"><span>可用余额</span><b class="num">¥{{ detail.account.availableBalanceYuan || '0.00' }}</b></div>
            <div class="detail-row"><span>冻结余额</span><b class="num">¥{{ detail.account.frozenBalanceYuan || '0.00' }}</b></div>
            <div class="detail-row"><span>总余额</span><b class="num">¥{{ detail.account.totalBalanceYuan || '0.00' }}</b></div>
          </div>
          <div class="detail-section" v-if="detail.identity">
            <div class="detail-title">实名信息</div>
            <div class="detail-row"><span>真实姓名</span><b>{{ detail.identity.idCard ? detail.identity.realName : '未实名' }}</b></div>
            <div class="detail-row"><span>证件号</span><b>{{ detail.identity.idCard || '—' }}</b></div>
            <div class="detail-row"><span>认证状态</span>
              <el-tag size="small" :type="detail.identity.status === 'VERIFIED' ? 'success' : 'info'">{{ detail.identity.status }}</el-tag>
            </div>
          </div>
          <div class="detail-section" v-if="detail.merchant">
            <div class="detail-title">商户</div>
            <div class="detail-row"><span>商户名称</span><b>{{ detail.merchant.merchantName }}</b></div>
            <div class="detail-row"><span>商户状态</span>
              <el-tag size="small">{{ detail.merchant.status }}</el-tag>
            </div>
          </div>
          <div class="detail-section" v-if="detail.loginLogs?.length">
            <div class="detail-title">最近登录</div>
            <div v-for="log in detail.loginLogs.slice(0, 5)" :key="log.id" class="detail-row">
              <span>{{ fmt(log.createdAt) }}</span>
              <el-tag size="small" :type="log.success ? 'success' : 'danger'">{{ log.success ? '成功' : log.reason || '失败' }}</el-tag>
            </div>
          </div>
        </template>
      </div>
    </el-drawer>
  </el-card>
</template>

<script setup lang="ts">
import { fmt } from '@/utils/format'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AdminUser } from '@/types'
import { fetchUsers, setUserStatus, fetchUserDetail } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<AdminUser[]>([])
const total = ref(0)
const loading = ref(true)
const keyword = ref('')
const status = ref('')
const query = reactive({ keyword: '', status: '', page: 1, limit: 15 })

const drawer = ref(false)
const detailLoading = ref(false)
const detail = ref<Record<string, any> | null>(null)

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

async function openDetail(row: AdminUser) {
  drawer.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await fetchUserDetail(row.id)
  } catch (e) { ElMessage.error(extractError(e)) } finally { detailLoading.value = false }
}

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
.detail-section { margin-bottom: 18px; }
.detail-title { font-size: 13px; font-weight: 600; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.detail-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--el-border-color-lighter); font-size: 13px; }
.detail-row span { color: var(--el-text-color-secondary); }
.detail-row b { font-weight: 600; color: var(--el-text-color-primary); }
</style>
