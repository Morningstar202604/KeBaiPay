<template>
  <el-card shadow="never">
    <div class="toolbar">
      <el-button type="primary" @click="openCreate">创建应用</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="appId" label="AppID" min-width="220" show-overflow-tooltip />
      <el-table-column prop="name" label="应用名称" min-width="140" />
      <el-table-column prop="callbackUrl" label="回调地址" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ row.callbackUrl || '-' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="180">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button link type="primary" @click="openRegen(row)">重置密钥</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="createVisible" :title="editTarget ? '编辑应用' : '创建应用'" width="440px">
      <el-form label-width="90px">
        <el-form-item label="应用名称">
          <el-input v-model="form.name" placeholder="请输入应用名称" />
        </el-form-item>
        <el-form-item label="回调地址">
          <el-input v-model="form.callbackUrl" placeholder="https://example.com/callback" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="secretVisible" title="应用密钥" width="440px">
      <el-alert title="请立即妥善保存，AppSecret 仅此一次完整显示。" type="warning" :closable="false" style="margin-bottom: 12px" />
      <el-input v-model="secret" readonly type="textarea" :rows="3" />
      <template #footer>
        <el-button type="primary" @click="secretVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { MerchantApp } from '@/types'
import {
  createApp, fetchApps, regenerateAppSecret, updateApp,
} from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<MerchantApp[]>([])
const loading = ref(false)
const saving = ref(false)
const createVisible = ref(false)
const secretVisible = ref(false)
const secret = ref('')
const editTarget = ref<MerchantApp | null>(null)
const form = reactive({ name: '', callbackUrl: '' })

function fmt(v: string) {
  return v ? v.replace('T', ' ').slice(0, 19) : '-'
}

async function load() {
  loading.value = true
  try {
    list.value = await fetchApps()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editTarget.value = null
  form.name = ''
  form.callbackUrl = ''
  createVisible.value = true
}

function openEdit(row: MerchantApp) {
  editTarget.value = row
  form.name = row.name
  form.callbackUrl = row.callbackUrl || ''
  createVisible.value = true
}

async function onSubmit() {
  saving.value = true
  try {
    if (editTarget.value) {
      await updateApp(editTarget.value.appId, {
        name: form.name,
        callbackUrl: form.callbackUrl || undefined,
      })
      ElMessage.success('已更新')
    } else {
      const res = await createApp({
        name: form.name,
        callbackUrl: form.callbackUrl || undefined,
      })
      secret.value = res.appSecret
      secretVisible.value = true
    }
    createVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    saving.value = false
  }
}

async function openRegen(row: MerchantApp) {
  try {
    const res = await regenerateAppSecret(row.appId)
    secret.value = res.appSecret
    secretVisible.value = true
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
</style>
