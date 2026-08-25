<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-button type="primary" @click="dialogVisible = true">创建收款码</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="code" label="收款码" min-width="200" show-overflow-tooltip />
      <el-table-column label="金额" width="120">
        <template #default="{ row }">
          {{ row.amount ? '¥ ' + (row.amount / 100).toFixed(2) : '不限' }}
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="180">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-popconfirm title="确定删除该收款码？" @confirm="onDelete(row)">
            <template #reference>
              <el-button link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="创建收款码" width="420px">
      <el-form label-width="80px">
        <el-form-item label="金额">
          <el-input-number
            v-model="amount"
            :min="0"
            :precision="2"
            :step="0.01"
            placeholder="留空为不限金额"
          />
          <div class="tip">金额单位：元，留空表示不限金额</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="remark" placeholder="收款码备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { fmt } from '@/utils/format'
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { MerchantQrCode } from '@/types'
import { createQrCode, deleteQrCode, fetchQrCodes } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<MerchantQrCode[]>([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const amount = ref<number | undefined>(undefined)
const remark = ref('')


async function load() {
  loading.value = true
  try {
    list.value = await fetchQrCodes()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

async function onCreate() {
  saving.value = true
  try {
    await createQrCode({
      // 契约：金额一律传"元"，由后端 yuanToFen 统一换算（此前前端先×100、后端再换算，
      // 导致收款码金额放大 100 倍）
      amount: amount.value != null ? amount.value : undefined,
      remark: remark.value.trim() || undefined,
    })
    ElMessage.success('创建成功')
    dialogVisible.value = false
    amount.value = undefined
    remark.value = ''
    load()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    saving.value = false
  }
}

async function onDelete(row: MerchantQrCode) {
  try {
    await deleteQrCode(row.id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    ElMessage.error(extractError(e))
  }
}

onMounted(load)
</script>

<style scoped>
.toolbar {
  margin-bottom: 16px;
}
.tip {
  font-size: 12px;
  color: #9ca3af;
}
</style>
