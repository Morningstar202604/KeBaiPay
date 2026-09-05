<template>
  <div class="agent-page">
    <!-- 未连接：选择智能体 -->
    <div v-if="!connected" class="setup">
      <div class="setup-head">
        <div class="setup-icon"><el-icon :size="26"><MagicStick /></el-icon></div>
        <h3>AI 智能助手</h3>
        <p>选择智能体，授权后即可通过对话管理钱包、查账单等</p>
      </div>
      <div v-if="agents.length === 0" class="empty">暂无可用智能体
① 管理后台「智能体管理」创建 ② 本页选择并授权 ③ 开始对话</div>
      <div v-else class="agent-list">
        <div
          v-for="a in agents"
          :key="a.id"
          class="agent-item"
          :class="{ selected: selectedId === a.id }"
          @click="selectedId = a.id"
        >
          <div class="agent-item-name">{{ a.name }}</div>
          <div class="agent-item-desc">{{ a.description || scenarioText(a.scenario) }}</div>
          <div class="agent-item-tags">
            <el-tag size="small">{{ scenarioText(a.scenario) }}</el-tag>
            <el-tag v-if="a.authorization" size="small" type="success">已授权</el-tag>
          </div>
        </div>
      </div>
      <el-button type="primary" size="large" class="btn" :loading="connecting" :disabled="!selectedId" @click="connect">
        连接智能体
      </el-button>
    </div>

    <!-- 已连接：对话 -->
    <div v-else class="chat">
      <div class="chat-head">
        <span>{{ agentName }}</span>
        <el-button link type="info" size="small" @click="disconnect">断开</el-button>
      </div>
      <div ref="chatBox" class="chat-body">
        <div v-if="messages.length === 0" class="chat-welcome">
          <el-icon :size="30"><MagicStick /></el-icon>
          <p>您好，我是{{ agentName }}，可以帮您查余额、查账单、转账、发红包等。请直接说您的需求。</p>
        </div>
        <div v-for="(m, i) in messages" :key="i" :class="['msg', m.role]">
          <div class="bubble">{{ m.content }}</div>
          <div v-if="m.pendingOps" class="pending">
            <div v-for="op in m.pendingOps" :key="op.opLogId" class="pending-op">
              <span>{{ op.message }}</span>
              <el-button size="small" type="success" @click="decide(op.opLogId, 'CONFIRM')">确认</el-button>
              <el-button size="small" type="danger" @click="decide(op.opLogId, 'REJECT')">拒绝</el-button>
            </div>
          </div>
        </div>
      </div>
      <div class="chat-input">
        <el-input
          v-model="input"
          placeholder="输入消息…"
          size="large"
          @keyup.enter="send"
        />
        <el-button type="primary" :loading="sending" @click="send">发送</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick } from '@element-plus/icons-vue'
import { listMyAgents, authorizeAgent, agentLogin, type MyAgent } from '@/api/modules'
import { agentRequest } from '@/api/agent'
import { extractError } from '@/api/http'

const agents = ref<MyAgent[]>([])
const selectedId = ref('')
const connecting = ref(false)
const connected = ref(false)
const agentToken = ref('')
const convId = ref('')
const agentName = ref('')
const messages = ref<Array<{ role: string; content: string; pendingOps?: any[] }>>([])
const input = ref('')
const sending = ref(false)
const chatBox = ref<HTMLDivElement>()

function scenarioText(s: string) {
  const m: Record<string, string> = { wallet: '钱包管家', merchant: '店长助理', risk: '风控审计官', support: '客服坐席' }
  return m[s] || s
}
function scrollBottom() {
  nextTick(() => { chatBox.value?.scrollTo({ top: chatBox.value.scrollHeight, behavior: 'smooth' }) })
}

async function load() {
  try { agents.value = await listMyAgents() } catch (e) { ElMessage.error(extractError(e)) }
}

async function connect() {
  const agent = agents.value.find((a) => a.id === selectedId.value)
  if (!agent) return
  connecting.value = true
  try {
    let authId = agent.authorization?.id
    if (!authId) {
      const scopes = agent.scopes.length ? agent.scopes : ['wallet:read']
      const auth = await authorizeAgent(agent.id, scopes)
      authId = auth.id
    }
    const login = await agentLogin(agent.id, authId!)
    agentToken.value = login.token
    const conv = await agentRequest<{ id: string }>(login.token, 'post', '/agent/conversations', { scenario: agent.scenario, title: '钱包助手会话' })
    convId.value = conv.id
    connected.value = true
    agentName.value = agent.name
    messages.value = []
  } catch (e) { ElMessage.error(extractError(e)) } finally { connecting.value = false }
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value) return
  messages.value.push({ role: 'user', content: text })
  input.value = ''
  sending.value = true
  scrollBottom()
  try {
    const res = await agentRequest<{ reply: string; pendingOps?: any[] }>(agentToken.value, 'post', '/agent/chat', { convId: convId.value, content: text })
    messages.value.push({ role: 'assistant', content: res.reply, pendingOps: res.pendingOps })
    scrollBottom()
  } catch (e) { ElMessage.error(extractError(e)) } finally { sending.value = false }
}

async function decide(opLogId: string, decision: 'CONFIRM' | 'REJECT') {
  try {
    const res = await agentRequest<{ success: boolean; message: string }>(agentToken.value, 'post', '/agent/confirm', { opLogId, decision })
    ElMessage.success(res.message || (decision === 'CONFIRM' ? '已确认执行' : '已拒绝'))
    // 追加一条系统反馈
    messages.value.push({ role: 'assistant', content: `操作${decision === 'CONFIRM' ? '已确认' : '已拒绝'}：${res.message || ''}` })
    scrollBottom()
  } catch (e) { ElMessage.error(extractError(e)) }
}

function disconnect() {
  connected.value = false
  agentToken.value = ''
  convId.value = ''
  messages.value = []
}

onMounted(load)
</script>

<style scoped>
.agent-page { min-height: 100%; }
.setup { padding: 20px 4px; }
.setup-head { text-align: center; margin-bottom: 20px; }
.setup-icon { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 16px; background: linear-gradient(135deg,#0fa968,#0ea5e9); color:#fff; display:flex; align-items:center; justify-content:center; box-shadow: 0 10px 24px rgba(15,169,104,.3); }
.setup-head h3 { margin: 0; color: var(--el-text-color-primary); }
.setup-head p { margin: 6px 0 0; font-size: 12px; color: var(--el-text-color-placeholder); }
.agent-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.agent-item { background:#fff; border:1px solid var(--el-border-color-lighter); border-radius:14px; padding:14px; transition: all var(--kb-base) var(--kb-ease); }
.agent-item.selected { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px rgba(15,169,104,.15); }
.agent-item-name { font-weight:600; color:var(--el-text-color-primary); }
.agent-item-desc { font-size:12px; color:var(--el-text-color-secondary); margin:4px 0 8px; }
.agent-item-tags { display:flex; gap:6px; }
.btn { width:100%; }
.empty { text-align:center; color:var(--el-text-color-placeholder); padding:30px 0; font-size:13px; }

.chat { display:flex; flex-direction:column; height: calc(100vh - 52px - 66px); }
.chat-head { display:flex; justify-content:space-between; align-items:center; padding:10px 2px; font-weight:600; }
.chat-body { flex:1; overflow-y:auto; padding: 4px 2px; }
.chat-welcome { text-align:center; color:var(--el-text-color-secondary); padding:40px 10px; font-size:13px; line-height:1.7; }
.msg { margin-bottom:12px; display:flex; flex-direction:column; }
.msg.user { align-items:flex-end; }
.msg.assistant { align-items:flex-start; }
.bubble { max-width:82%; padding:10px 14px; border-radius:14px; font-size:14px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
.msg.user .bubble { background: linear-gradient(135deg,#0fa968,#0c8a57); color:#fff; border-bottom-right-radius:4px; }
.msg.assistant .bubble { background:#fff; border:1px solid var(--el-border-color-lighter); color:var(--el-text-color-primary); border-bottom-left-radius:4px; }
.pending { margin-top:8px; display:flex; flex-direction:column; gap:6px; width:100%; }
.pending-op { display:flex; align-items:center; gap:8px; background:#fef3c7; border-radius:10px; padding:8px 12px; font-size:12px; color:#92400e; }
.chat-input { display:flex; gap:8px; padding-top:10px; }
</style>
