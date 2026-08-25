<template>
  <div class="card">
    <el-form label-position="top" @keyup.enter="submit">
      <el-form-item label="提现金额（元）">
        <el-input-number v-model="amount" :min="0.01" :max="500000" :precision="2" size="large" style="width: 100%" />
      </el-form-item>
      <el-form-item label="收款银行卡号">
        <el-input v-model="channelAccount" placeholder="12-19 位银行卡号" size="large" />
      </el-form-item>
      <el-form-item label="支付密码">
        <el-input v-model="payPassword" type="password" maxlength="6" placeholder="6 位支付密码" size="large" show-password />
      </el-form-item>
      <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">提交提现</el-button>
    </el-form>
    <div class="tip">提现需审核通过后到账，请确认银行卡号正确。</div>

    <el-divider />
    <div class="section-title">提现记录</div>
    <el-table :data="records" v-loading="recordsLoading" size="small" stripe>
      <el-table-column prop="createdAt" label="时间" width="110">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="金额" width="100">
        <template #default="{ row }">¥{{ (row.amount / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'SUCCESS' ? 'success' : row.status === 'FAILED' || row.status === 'REJECTED' ? 'danger' : 'warning'">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { withdraw, fetchWithdrawals } from '@/api/modules'
import { extractError } from '@/api/http'

interface WithdrawalRecord {
  id: string
  amount: number
  status: string
  remark?: string | null
  createdAt: string
}

const amount = ref(100)
const channelAccount = ref('')
const payPassword = ref('')
const loading = ref(false)
const records = ref<WithdrawalRecord[]>([])
const recordsLoading = ref(false)

function fmt(v: string) { return v ? v.replace('T', ' ').slice(0, 16).replace(/-/g, '/') : '-' }
function statusText(s: string) {
  const map: Record<string, string> = {
    PENDING: '待审核',
    PROCESSING: '打款中',
    SUCCESS: '成功',
    FAILED: '失败',
    REJECTED: '已拒绝',
  }
  return map[s] || s
}

async function submit() {
  if (!amount.value || amount.value <= 0) return ElMessage.warning('请输入提现金额')
  if (!/^\d{12,19}$/.test(channelAccount.value)) return ElMessage.warning('请输入 12-19 位银行卡号')
  if (!payPassword.value) return ElMessage.warning('请输入支付密码')
  loading.value = true
  try {
    await withdraw({
      amount: amount.value,
      channelAccount: channelAccount.value,
      payPassword: payPassword.value,
      idempotencyKey: `withdraw-${Date.now()}`,
    })
    ElMessage.success('提现申请已提交')
    loadRecords()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const res = await fetchWithdrawals()
    // 接口返回完整订单数组（含账户等字段），此处仅取列表展示所需字段
    records.value = (Array.isArray(res) ? res : []) as WithdrawalRecord[]
  } catch {
    // 记录加载失败不阻塞主流程
  } finally {
    recordsLoading.value = false
  }
}

onMounted(loadRecords)
</script>

<style scoped>
.card { background: #fff; border-radius: 12px; padding: 20px; }
.btn { width: 100%; margin-top: 8px; }
.tip { margin-top: 12px; font-size: 12px; color: #9ca3af; }
.section-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #374151; }
</style>
