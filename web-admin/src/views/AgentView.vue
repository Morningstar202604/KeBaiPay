<template>
  <el-card shadow="never">
    <div class="toolbar">
      <div>
        <div class="page-title">智能体管理</div>
        <div class="page-sub">创建并管理 AI 智能体（钱包管家 / 店长助理 / 风控审计官等），配置其可执行的作用域</div>
      </div>
      <el-button type="primary" @click="openCreate">新建智能体</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="name" label="名称" min-width="130" />
      <el-table-column prop="agentNo" label="编号" width="170" show-overflow-tooltip />
      <el-table-column label="场景" width="110">
        <template #default="{ row }">
          <el-tag>{{ scenarioText(row.scenario) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
      <el-table-column label="作用域" min-width="180">
        <template #default="{ row }">
          <div v-if="row.scopes" class="scopes">
            <el-tag v-for="s in parseScopes(row.scopes)" :key="s" size="small" type="info">{{ s }}</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'ACTIVE'" link type="danger" @click="toggleStatus(row, 'DISABLED')">停用</el-button>
          <el-button v-else link type="success" @click="toggleStatus(row, 'ACTIVE')">启用</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑智能体' : '新建智能体'" width="480px">
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：钱包管家" />
        </el-form-item>
        <el-form-item label="场景" required>
          <el-select v-model="form.scenario" style="width: 100%" :disabled="!!editing">
            <el-option label="钱包管家（C端）" value="wallet" />
            <el-option label="店长助理（B端商户）" value="merchant" />
            <el-option label="风控审计官（A端）" value="risk" />
            <el-option label="客服坐席（support）" value="support" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="智能体职责描述" />
        </el-form-item>
        <el-form-item label="作用域">
          <el-select v-model="form.scopes" multiple filterable allow-create default-first-option style="width: 100%" placeholder="输入并回车添加，如 wallet:read">
            <el-option v-for="s in scopeOptions" :key="s" :label="s" :value="s" />
          </el-select>
          <div class="tip">作用域格式：<code>域:动作</code>（如 wallet:read / wallet:write:transfer / merchant:read / risk:read）</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { fmt } from '@/utils/format'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { AgentItem } from '@/api/modules'
import { fetchAgents, createAgent, updateAgent } from '@/api/modules'
import { extractError } from '@/api/http'

const list = ref<AgentItem[]>([])
const loading = ref(true)
const saving = ref(false)
const dialogVisible = ref(false)
const editing = ref<AgentItem | null>(null)
const scopeOptions = [
  'wallet:read', 'wallet:notify', 'wallet:write:coupon', 'wallet:write:transfer',
  'merchant:read', 'merchant:write', 'risk:read',
]
const form = reactive({ name: '', scenario: 'wallet', description: '', scopes: [] as string[] })

function scenarioText(s: string) {
  const m: Record<string, string> = { wallet: '钱包管家', merchant: '店长助理', risk: '风控审计官', support: '客服坐席' }
  return m[s] || s
}
function parseScopes(s: unknown): string[] {
  if (typeof s !== 'string') return []
  try {
    const arr = JSON.parse(s)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

async function load() {
  loading.value = true
  try { list.value = await fetchAgents() } catch (e) { ElMessage.error(extractError(e)) } finally { loading.value = false }
}
function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', scenario: 'wallet', description: '', scopes: [] })
  dialogVisible.value = true
}
function openEdit(row: AgentItem) {
  editing.value = row
  Object.assign(form, { name: row.name, scenario: row.scenario, description: row.description || '', scopes: parseScopes(row.scopes) })
  dialogVisible.value = true
}
async function save() {
  if (!form.name) return ElMessage.warning('请输入名称')
  saving.value = true
  try {
    if (editing.value) await updateAgent(editing.value.id, { name: form.name, description: form.description, scopes: form.scopes })
    else await createAgent({ name: form.name, scenario: form.scenario, description: form.description, scopes: form.scopes })
    ElMessage.success('已保存')
    dialogVisible.value = false
    load()
  } catch (e) { ElMessage.error(extractError(e)) } finally { saving.value = false }
}
async function toggleStatus(row: AgentItem, status: string) {
  try {
    await updateAgent(row.id, { status })
    ElMessage.success(status === 'ACTIVE' ? '已启用' : '已停用')
    load()
  } catch (e) { ElMessage.error(extractError(e)) }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.scopes { display: flex; flex-wrap: wrap; gap: 4px; }
.tip { font-size: 12px; color: var(--el-text-color-placeholder); margin-top: 4px; }
</style>
