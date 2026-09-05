<template>
  <div class="card">
    <el-form label-position="top" @keyup.enter="submit">
      <el-form-item label="收款用户 ID">
        <el-input v-model="toUserId" placeholder="输入对方用户 ID" size="large" />
      </el-form-item>
      <el-form-item label="转账金额（元）">
        <el-input-number v-model="amount" :min="0.01" :max="500000" :precision="2" size="large" style="width: 100%" />
        <!-- 限额进度条（P1-17）：今日额度实时可见，超额提前拦截 -->
        <div class="limit-box" v-if="limit">
          <el-progress
            :percentage="limitPct"
            :stroke-width="8"
            :color="limitPct >= 100 ? '#ef4444' : limitPct >= 80 ? '#f59e0b' : '#0fa968'"
          />
          <div class="limit-text">
            今日额度：已用 ¥{{ limit.usedYuan }} / ¥{{ limit.limitYuan }}，剩余 ¥{{ limit.remainingYuan }}
            <span v-if="overLimit" class="limit-warn">（本次金额已超出剩余额度）</span>
          </div>
        </div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="remark" placeholder="选填" size="large" />
      </el-form-item>
      <el-form-item label="支付密码">
        <el-input v-model="payPassword" type="password" maxlength="6" placeholder="6 位支付密码" size="large" show-password />
      </el-form-item>
      <el-button type="primary" size="large" class="btn" :loading="loading" :disabled="overLimit" @click="submit">确认转账</el-button>
    </el-form>
    <div class="tip">向用户转账后余额立即扣减，请确认收款方 ID 无误。</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { transfer, fetchDailyLimit } from '@/api/modules'
import { extractError } from '@/api/http'

const toUserId = ref('')
const amount = ref(1)
const remark = ref('')
const payPassword = ref('')
const loading = ref(false)

// 今日限额（P1-17）：加载数据失败不影响转账（后端仍会校验）
const limit = ref<{ limitYuan: string; usedYuan: string; remainingYuan: string } | null>(null)
const limitPct = computed(() => {
  if (!limit.value) return 0
  const used = Number(limit.value.usedYuan)
  const total = Number(limit.value.limitYuan)
  if (!total) return 0
  return Math.min(100, Math.round((used / total) * 100))
})
const overLimit = computed(() => {
  if (!limit.value) return false
  return Number(amount.value) > Number(limit.value.remainingYuan)
})

onMounted(async () => {
  try {
    limit.value = await fetchDailyLimit()
  } catch {
    // 限额加载失败静默忽略，提交时后端兜底校验
  }
})

async function submit() {
  if (!toUserId.value) return ElMessage.warning('请输入收款用户 ID')
  if (!amount.value || amount.value <= 0) return ElMessage.warning('请输入转账金额')
  if (overLimit.value) return ElMessage.warning('转账金额超出今日剩余额度')
  if (!payPassword.value) return ElMessage.warning('请输入支付密码')
  // 二次确认：转账不可逆，弹出收款人+金额核对（P1-17）
  try {
    await ElMessageBox.confirm(
      '向用户 ' + toUserId.value.trim() + ' 转账 ¥' + amount.value.toFixed(2) + '，确认无误？',
      '确认转账',
      { confirmButtonText: '确认转账', cancelButtonText: '再想想', type: 'warning' },
    )
  } catch { return }
  loading.value = true
  try {
    await transfer({
      toUserId: toUserId.value.trim(),
      amount: amount.value,
      remark: remark.value.trim() || undefined,
      payPassword: payPassword.value,
      idempotencyKey: `transfer-${Date.now()}`,
    })
    ElMessage.success('转账成功')
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.card { background: #fff; border-radius: 12px; padding: 20px; }
.btn { width: 100%; margin-top: 8px; }
.tip { margin-top: 12px; font-size: 12px; color: #9ca3af; }
.limit-box { width: 100%; margin-top: 8px; }
.limit-text { font-size: 12px; color: #9ca3af; margin-top: 4px; }
.limit-warn { color: #ef4444; font-weight: 600; }
</style>
