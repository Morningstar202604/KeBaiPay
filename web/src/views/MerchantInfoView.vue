<template>
  <el-card shadow="never" v-loading="loading">
    <template #header>商户资料</template>

    <el-descriptions v-if="merchant" :column="2" border style="margin-bottom: 20px">
      <el-descriptions-item label="商户号">{{ merchant.merchantNo }}</el-descriptions-item>
      <el-descriptions-item label="状态">
        <el-tag :type="statusType(merchant.status)">{{ statusText(merchant.status) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="商户名称">{{ merchant.merchantName }}</el-descriptions-item>
      <el-descriptions-item label="收款费率">{{ rateText(merchant.payRate) }}</el-descriptions-item>
      <el-descriptions-item label="提现费率">{{ rateText(merchant.withdrawRate) }}</el-descriptions-item>
      <el-descriptions-item label="每日收款限额">¥ {{ merchant.dailyLimitYuan }}</el-descriptions-item>
      <el-descriptions-item label="联系人">{{ merchant.contactName || '-' }}</el-descriptions-item>
      <el-descriptions-item label="联系电话">{{ merchant.contactPhone || '-' }}</el-descriptions-item>
      <el-descriptions-item label="入驻时间" :span="2">{{ fmt(merchant.createdAt) }}</el-descriptions-item>
    </el-descriptions>

    <el-form v-if="merchant" :model="form" label-width="90px" style="max-width: 480px">
      <el-form-item label="商户名称">
        <el-input v-model="form.merchantName" />
      </el-form-item>
      <el-form-item label="联系人">
        <el-input v-model="form.contactName" />
      </el-form-item>
      <el-form-item label="联系电话">
        <el-input v-model="form.contactPhone" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" :disabled="merchant.status !== 'PENDING' && merchant.status !== 'REJECTED'" @click="save">
          保存修改
        </el-button>
        <span v-if="merchant.status !== 'PENDING' && merchant.status !== 'REJECTED'" class="hint">
          仅待审核/已驳回状态下可修改
        </span>
      </el-form-item>
    </el-form>

    <el-empty v-else-if="!loading" description="尚未入驻商户">
      <el-button type="primary" @click="$router.push('/merchant/register')">去入驻申请</el-button>
    </el-empty>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { MerchantInfo } from '@/types'
import { fetchMerchantInfo, updateMerchantInfo } from '@/api/modules'
import { extractError } from '@/api/http'

const loading = ref(false)
const saving = ref(false)
const merchant = ref<MerchantInfo | null>(null)
const form = reactive({ merchantName: '', contactName: '', contactPhone: '' })

function statusText(s: string) {
  const map: Record<string, string> = {
    PENDING: '待审核',
    APPROVED: '已通过',
    REJECTED: '已驳回',
    SUSPENDED: '已停用',
  }
  return map[s] || s
}
function statusType(s: string) {
  const map: Record<string, 'info' | 'success' | 'danger' | 'warning'> = {
    PENDING: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    SUSPENDED: 'info',
  }
  return map[s] || 'info'
}
function rateText(r: number) {
  return r != null ? `${(r / 100).toFixed(2)}%` : '-'
}
function fmt(v: string) {
  return v ? v.replace('T', ' ').slice(0, 19) : '-'
}

async function load() {
  loading.value = true
  try {
    merchant.value = await fetchMerchantInfo()
    form.merchantName = merchant.value.merchantName
    form.contactName = merchant.value.contactName || ''
    form.contactPhone = merchant.value.contactPhone || ''
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await updateMerchantInfo({
      merchantName: form.merchantName,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
    })
    ElMessage.success('已保存')
    load()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.hint {
  font-size: 12px;
  color: #9ca3af;
  margin-left: 8px;
}
</style>
