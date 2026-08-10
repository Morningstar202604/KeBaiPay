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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { withdraw } from '@/api/modules'
import { extractError } from '@/api/http'

const amount = ref(100)
const channelAccount = ref('')
const payPassword = ref('')
const loading = ref(false)

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
