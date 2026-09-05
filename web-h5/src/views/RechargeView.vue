<template>
  <div class="card">
    <el-form label-position="top" @keyup.enter="submit">
      <el-form-item label="充值金额（元）">
        <div class="quick-amounts">
          <button
            v-for="q in quickAmounts"
            :key="q"
            type="button"
            class="quick-chip"
            :class="{ active: amount === q }"
            @click="amount = q"
          >
            ¥{{ q }}
          </button>
        </div>
        <el-input-number v-model="amount" :min="0.01" :max="500000" :precision="2" :step="10" size="large" style="width: 100%" />
      </el-form-item>
      <el-form-item label="支付密码">
        <el-input v-model="payPassword" type="password" maxlength="6" placeholder="请输入 6 位支付密码" size="large" show-password />
      </el-form-item>
      <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">确认充值</el-button>
    </el-form>
    <el-alert v-if="result" :title="`充值订单 ${result.orderNo} 已创建，状态：${result.status}`" type="success" :closable="false" style="margin-top: 12px" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { recharge } from '@/api/modules'
import { extractError } from '@/api/http'

const quickAmounts = [100, 500, 1000, 5000]
const amount = ref(100)
const payPassword = ref('')
const loading = ref(false)
const result = ref<{ orderNo: string; status: string } | null>(null)

async function submit() {
  if (!amount.value || amount.value <= 0) return ElMessage.warning('请输入充值金额')
  if (!payPassword.value) return ElMessage.warning('请输入支付密码')
  loading.value = true
  try {
    result.value = await recharge({
      amount: amount.value,
      payPassword: payPassword.value,
      idempotencyKey: `recharge-${Date.now()}`,
    })
    ElMessage.success('充值订单已创建')
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
</style>

.quick-amounts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; width: 100%; }
.quick-chip { height: 38px; border-radius: 10px; border: 1px solid var(--el-border-color); background: var(--el-fill-color-blank); font-size: 14px; font-weight: 600; color: var(--el-text-color-regular); cursor: pointer; transition: all .15s ease; }
.quick-chip:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.quick-chip.active { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary); color: var(--el-color-primary); }
