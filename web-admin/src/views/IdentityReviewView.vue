<template>
  <div class="page">
    <div class="head">
      <h2>实名审核</h2>
      <p class="sub">商户漏斗的第一道闸门：通过后用户方可收款/提现。开启 SANDBOX_AUTO_APPROVE 时此列表通常为空（提交即自动通过）。</p>
    </div>

    <el-card shadow="never">
      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column label="用户" min-width="180">
          <template #default="{ row }">
            <div class="u">{{ row.user?.nickname || '—' }}</div>
            <div class="s">{{ row.user?.phone || row.user?.email || row.user?.id }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="realName" label="姓名" width="120" />
        <el-table-column label="身份证号" width="170">
          <template #default="{ row }">{{ row.idCardMasked || mask(row.idCard) }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="onApprove(row)">通 过</el-button>
            <el-button type="danger" plain size="small" @click="onReject(row)">驳 回</el-button>
          </template>
        </el-table-column>
        <template #empty>暂无待审核实名</template>
      </el-table>

      <div class="pager">
        <el-pagination
          background
          layout="prev, pager, next, total"
          :total="total"
          :page-size="limit"
          :current-page="page"
          @current-change="(p: number) => { page = p; load() }"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { approveIdentity, fetchPendingIdentities, rejectIdentity, type PendingIdentity } from '@/api/modules'
import { extractError } from '@/api/http'

const rows = ref<PendingIdentity[]>([])
const total = ref(0)
const page = ref(1)
const limit = 20
const loading = ref(false)

function mask(v?: string): string {
  if (!v) return '—'
  return v.length > 10 ? `${v.slice(0, 6)}********${v.slice(-4)}` : '****'
}
function fmtTime(s: string): string {
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const res = await fetchPendingIdentities({ page: page.value, limit })
    rows.value = res.data as unknown as PendingIdentity[]
    total.value = res.total
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

async function onApprove(row: PendingIdentity) {
  await ElMessageBox.confirm(`确认通过「${row.realName}」的实名认证？通过后将写入其支付密码。`, '实名审核')
  try {
    await approveIdentity(row.id)
    ElMessage.success('已通过')
    await load()
  } catch (e) {
    ElMessage.error(extractError(e))
  }
}

async function onReject(row: PendingIdentity) {
  const { value } = await ElMessageBox.prompt('请输入驳回原因（必填）', `驳回 ${row.realName}`, {
    inputValidator: (v: string) => (v && v.trim() ? true : '原因不能为空'),
  })
  try {
    await rejectIdentity(row.id, { reason: value.trim() })
    ElMessage.success('已驳回')
    await load()
  } catch (e) {
    ElMessage.error(extractError(e))
  }
}

onMounted(load)
</script>

<style scoped>
.head h2 { margin: 0 0 6px; font-size: 18px; }
.sub { margin: 0 0 14px; color: var(--el-text-color-secondary); font-size: 13px; }
.u { font-weight: 600; }
.s { font-size: 12px; color: var(--el-text-color-placeholder); }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
