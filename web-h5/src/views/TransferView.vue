<template>
  <div class="card">
    <el-form label-position="top" @keyup.enter="submit">
      <el-form-item label="收款用户 ID">
        <el-input v-model="toUserId" placeholder="输入对方用户 ID" size="large" />
      </el-form-item>
      <el-form-item label="转账金额（元）">
        <el-input-number v-model="amount" :min="0.01" :max="500000" :precision="2" size="large" style="width: 100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="remark" placeholder="选填" size="large" />
      </el-form-item>
      <el-form-item label="支付密码">
        <el-input v-model="payPassword" type="password" maxlength="6" placeholder="6 位支付密码" size="large" show-password />
      </el-form-item>
      <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">确认转账</el-button>
    </el-form>
    <div class="tip">向用户转账后余额立即扣减，请确认收款方 ID 无误。</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { transfer } from '@/api/modules'
import { extractError } from '@/api/http'

const toUserId = ref('')
const amount = ref(1)
const remark = ref('')
const payPassword = ref('')
const loading = ref(false)

async function submit() {
  if (!toUserId.value) return ElMessage.warning('请输入收款用户 ID')
  if (!amount.value || amount.value <= 0) return ElMessage.warning('请输入转账金额')
  if (!payPassword.value) return ElMessage.warning('请输入支付密码')
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
</style>
