<template>
  <div>
    <el-card shadow="never" class="card">
      <template #header>创建付款订单</template>
      <el-form label-position="top">
        <el-form-item label="商户订单号">
          <el-input v-model="merchantOrderNo" placeholder="唯一订单号" size="large" />
        </el-form-item>
        <el-form-item label="商品名称">
          <el-input v-model="subject" placeholder="如：会员充值" size="large" />
        </el-form-item>
        <el-form-item label="金额（元）">
          <el-input-number v-model="amount" :min="0.01" :precision="2" size="large" style="width: 100%" />
        </el-form-item>
        <el-button type="primary" size="large" class="btn" :loading="creating" @click="create">创建订单</el-button>
      </el-form>
    </el-card>

    <el-card shadow="never" class="card">
      <template #header>我的订单</template>
      <el-skeleton v-if="loading" :rows="4" animated />
      <div v-else-if="orders.length === 0" class="empty">暂无订单</div>
      <div v-for="o in orders" :key="o.id" class="row">
        <div>
          <div>{{ o.subject }} · {{ o.orderNo }}</div>
          <div class="sub">{{ statusText(o.status) }} · {{ fmt(o.createdAt) }}</div>
        </div>
        <div class="right">
          <div class="amt">¥{{ o.amountYuan }}</div>
          <el-button v-if="o.status === 'PENDING'" size="small" type="primary" @click="pay(o)">支付</el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CashierOrder } from '@/types'
import { createCashierOrder, fetchCashierOrders, payCashierOrder } from '@/api/modules'
import { extractError } from '@/api/http'

const merchantOrderNo = ref(`MO${Date.now()}`)
const subject = ref('')
const amount = ref(10)
const creating = ref(false)
const loading = ref(true)
const orders = ref<CashierOrder[]>([])

function statusText(s: string) {
  const map: Record<string, string> = { PENDING: '待支付', PAID: '已支付', CLOSED: '已关闭', REFUNDED: '已退款' }
  return map[s] || s
}
function fmt(v: string) {
  return v ? v.replace('T', ' ').slice(0, 16) : ''
}

async function create() {
  if (!merchantOrderNo.value || !subject.value) return ElMessage.warning('请填写订单号与商品名称')
  if (!amount.value || amount.value <= 0) return ElMessage.warning('请输入金额')
  creating.value = true
  try {
    await createCashierOrder({
      merchantOrderNo: merchantOrderNo.value.trim(),
      amount: amount.value,
      subject: subject.value.trim(),
    })
    ElMessage.success('订单已创建')
    load()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    creating.value = false
  }
}

async function pay(o: CashierOrder) {
  try {
    const { value } = await ElMessageBox.prompt('请输入 6 位支付密码', '支付确认', {
      inputType: 'password',
      inputPattern: /^\d{6}$/,
      inputErrorMessage: '支付密码为 6 位数字',
    })
    await payCashierOrder(o.orderNo, value)
    ElMessage.success('支付成功')
    load()
  } catch (e: unknown) {
    if ((e as { __CANCEL__?: boolean })?.__CANCEL__) return
    ElMessage.error(extractError(e))
  }
}

async function load() {
  loading.value = true
  try {
    const res = await fetchCashierOrders()
    orders.value = res.data
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.card { border-radius: 10px; margin-bottom: 12px; }
.btn { width: 100%; }
.row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
.sub { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.amt { color: #ef4444; font-weight: 600; }
.empty { color: #9ca3af; text-align: center; padding: 24px; font-size: 13px; }
</style>
