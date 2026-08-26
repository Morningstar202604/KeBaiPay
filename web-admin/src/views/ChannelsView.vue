<template>
  <div class="page">
    <div class="head">
      <h2>渠道配置中心</h2>
      <p class="sub">图形化接入微信 / 支付宝等支付渠道：凭据加密存储，保存后热同步到连接器运行时。mock 渠道仅限开发环境。</p>
    </div>

    <el-card shadow="never">
      <div class="toolbar">
        <el-button type="primary" @click="openCreate">新增渠道</el-button>
        <el-button @click="load" :loading="loading">刷新</el-button>
      </div>

      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="code" label="编码" width="110" />
        <el-table-column prop="name" label="名称" width="140" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.type === 'PAYOUT' ? 'warning' : row.type === 'RECHARGE' ? 'success' : 'info'" effect="plain">
              {{ row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="90">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="(v: boolean) => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="90" />
        <el-table-column label="凭据摘要" min-width="220">
          <template #default="{ row }">{{ summarize(row.config) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编 辑</el-button>
            <el-button size="small" type="success" plain @click="onTest(row)">测 试</el-button>
            <el-button size="small" type="danger" plain @click="onDelete(row)">删 除</el-button>
          </template>
        </el-table-column>
        <template #empty>暂无渠道配置</template>
      </el-table>
    </el-card>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dialog.visible" :title="dialog.mode === 'create' ? '新增渠道' : `编辑渠道：${dialog.form.code}`" width="560px">
      <el-form :model="dialog.form" label-width="90px">
        <el-form-item label="编码" required>
          <el-input v-model="dialog.form.code" :disabled="dialog.mode === 'edit'" placeholder="如 alipay / wechat（与后端注册的渠道 code 一致）" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="dialog.form.name" placeholder="如 支付宝" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="dialog.form.type" style="width: 100%">
            <el-option label="充值 RECHARGE" value="RECHARGE" />
            <el-option label="代付 PAYOUT" value="PAYOUT" />
            <el-option label="两者 BOTH" value="BOTH" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="dialog.form.priority" :min="0" :max="9999" />
          <span class="hint">数字越大越优先；同类型多渠道时按此排序选择</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="dialog.form.enabled" />
        </el-form-item>
        <el-form-item label="凭据 JSON">
          <el-input
            v-model="dialog.form.config"
            type="textarea"
            :rows="7"
            placeholder='{"appId":"...","privateKey":"...","alipayPublicKey":"..."}'
          />
          <div class="hint">
            敏感字段（私钥/apiV3Key 等）服务端会自动 AES-256-GCM 加密存储；编辑时留空的字段保持原值不变。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取 消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="save">保 存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  createChannel,
  deleteChannel,
  fetchChannels,
  testChannel,
  updateChannel,
  type ChannelConfigRow,
} from '@/api/modules'
import { extractError } from '@/api/http'

const rows = ref<ChannelConfigRow[]>([])
const loading = ref(false)

const dialog = reactive({
  visible: false,
  mode: 'create' as 'create' | 'edit',
  saving: false,
  form: { code: '', name: '', type: 'RECHARGE', enabled: true, priority: 10, config: '{}' },
})

function summarize(configJson: string): string {
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>
    const keys = Object.keys(parsed)
    if (!keys.length) return '—'
    return keys.map((k) => k).join('、') + '（已脱敏）'
  } catch {
    return configJson ? '（非法 JSON）' : '—'
  }
}

async function load() {
  loading.value = true
  try {
    rows.value = await fetchChannels()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  dialog.mode = 'create'
  Object.assign(dialog.form, { code: '', name: '', type: 'RECHARGE', enabled: true, priority: 10, config: '{}' })
  dialog.visible = true
}

function openEdit(row: ChannelConfigRow) {
  dialog.mode = 'edit'
  Object.assign(dialog.form, {
    code: row.code,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    priority: row.priority,
    // 编辑时不回填真实凭据（列表返回的已是脱敏值），仅当用户显式输入新值才覆盖
    config: '{}',
  })
  dialog.visible = true
}

async function save() {
  if (!dialog.form.code.trim() || !dialog.form.name.trim()) {
    ElMessage.warning('编码与名称必填')
    return
  }
  try {
    JSON.parse(dialog.form.config || '{}')
  } catch {
    ElMessage.error('凭据必须是合法 JSON')
    return
  }
  dialog.saving = true
  try {
    if (dialog.mode === 'create') {
      await createChannel({ ...dialog.form, code: dialog.form.code.trim(), name: dialog.form.name.trim() })
      ElMessage.success('已创建')
    } else {
      await updateChannel(dialog.form.code, {
        name: dialog.form.name.trim(),
        type: dialog.form.type,
        enabled: dialog.form.enabled,
        priority: dialog.form.priority,
        // 空对象 {} 表示不修改凭据字段
        config: dialog.form.config === '' ? undefined : dialog.form.config,
      })
      ElMessage.success('已保存')
    }
    dialog.visible = false
    await load()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    dialog.saving = false
  }
}

async function toggleEnabled(row: ChannelConfigRow, v: boolean) {
  try {
    await updateChannel(row.code, { enabled: v })
    row.enabled = v
    ElMessage.success(v ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(extractError(e))
  }
}

async function onTest(row: ChannelConfigRow) {
  try {
    const res = await testChannel(row.code)
    res.available
      ? ElMessage.success(res.message)
      : ElMessage.warning(res.message)
  } catch (e) {
    ElMessage.error(extractError(e))
  }
}

async function onDelete(row: ChannelConfigRow) {
  await ElMessageBox.confirm(`确认删除渠道「${row.name}」？该操作不可恢复。`, '删除渠道', { type: 'warning' })
  try {
    await deleteChannel(row.code)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(extractError(e))
  }
}

onMounted(load)
</script>

<style scoped>
.head h2 { margin: 0 0 6px; font-size: 18px; }
.sub { margin: 0 0 14px; color: var(--el-text-color-secondary); font-size: 13px; }
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
.hint { color: var(--el-text-color-placeholder); font-size: 12px; line-height: 1.6; }
</style>
