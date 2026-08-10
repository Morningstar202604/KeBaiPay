<template>
  <div>
    <el-card shadow="never" class="card">
      <template #header>发红包</template>
      <el-form label-position="top">
        <el-form-item label="红包类型">
          <el-radio-group v-model="type">
            <el-radio value="LUCKY">拼手气</el-radio>
            <el-radio value="ORDINARY">普通</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="总金额（元）">
          <el-input-number v-model="amount" :min="0.01" :precision="2" size="large" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="type === 'LUCKY'" label="红包个数">
          <el-input-number v-model="totalCount" :min="1" :max="100" size="large" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="remark" placeholder="选填" size="large" />
        </el-form-item>
        <el-form-item label="支付密码">
          <el-input v-model="payPassword" type="password" maxlength="6" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" class="btn" :loading="sending" @click="send">发出红包</el-button>
      </el-form>
    </el-card>

    <el-card shadow="never" class="card">
      <template #header>领红包</template>
      <el-input v-model="packetNo" placeholder="输入红包编号" size="large" style="margin-bottom: 10px" />
      <el-input v-model="pwd" placeholder="口令红包密码（选填）" size="large" style="margin-bottom: 10px" />
      <el-button type="success" size="large" class="btn" :loading="receiving" @click="receive">领取红包</el-button>
    </el-card>

    <el-card shadow="never" class="card">
      <template #header>已发红包</template>
      <div v-for="p in sent" :key="p.id" class="row">
        <div>
          <div>{{ p.remark || '红包' }} · {{ p.packetNo }}</div>
          <div class="sub">{{ fmt(p.createdAt) }} · {{ p.receivedCount }}/{{ p.totalCount }}</div>
        </div>
        <div class="amt">¥{{ p.amountYuan || (p.amount / 100).toFixed(2) }}</div>
      </div>
      <div v-if="sent.length === 0" class="empty">暂无已发红包</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { RedPacket } from '@/types'
import { receiveRedPacket, sendRedPacket, fetchSentRedPackets } from '@/api/modules'
import { extractError } from '@/api/http'

const type = ref('LUCKY')
const amount = ref(100)
const totalCount = ref(10)
const remark = ref('')
const payPassword = ref('')
const sending = ref(false)
const packetNo = ref('')
const pwd = ref('')
const receiving = ref(false)
const sent = ref<RedPacket[]>([])

function fmt(v: string) {
  return v ? v.replace('T', ' ').slice(0, 16) : ''
}

async function send() {
  if (!amount.value || amount.value <= 0) return ElMessage.warning('请输入金额')
  if (!payPassword.value) return ElMessage.warning('请输入支付密码')
  sending.value = true
  try {
    await sendRedPacket({
      amount: amount.value,
      payPassword: payPassword.value,
      remark: remark.value.trim() || undefined,
      type: type.value,
      totalCount: type.value === 'LUCKY' ? totalCount.value : undefined,
      idempotencyKey: `rp-${Date.now()}`,
    })
    ElMessage.success('红包已发出')
    load()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    sending.value = false
  }
}

async function receive() {
  if (!packetNo.value) return ElMessage.warning('请输入红包编号')
  receiving.value = true
  try {
    const res = await receiveRedPacket(packetNo.value.trim(), { password: pwd.value || undefined })
    ElMessage.success(`领取成功：${JSON.stringify(res)}`)
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    receiving.value = false
  }
}

async function load() {
  try {
    sent.value = await fetchSentRedPackets()
  } catch { /* ignore */ }
}

onMounted(load)
</script>

<style scoped>
.card { border-radius: 10px; margin-bottom: 12px; }
.btn { width: 100%; }
.row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
.sub { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.amt { color: #ef4444; font-weight: 600; }
.empty { color: #9ca3af; text-align: center; padding: 12px; font-size: 13px; }
</style>
