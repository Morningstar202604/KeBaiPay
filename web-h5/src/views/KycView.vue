<template>
  <div class="page">
    <div class="head">
      <h2>实名认证</h2>
      <p>依据监管要求，收款/提现前需完成实名。信息加密存储，仅用于核验。</p>
    </div>
    <el-alert v-if="verified" type="success" :closable="false" title="已完成实名认证" description="你的账户已通过实名核验，可正常使用全部钱包功能。" />
    <el-card v-else shadow="never" class="card">
      <el-form :model="form" :rules="rules" ref="formRef" label-position="top">
        <el-form-item label="真实姓名" prop="realName">
          <el-input v-model="form.realName" placeholder="与身份证一致" maxlength="30" />
        </el-form-item>
        <el-form-item label="身份证号" prop="idCard">
          <el-input v-model="form.idCard" placeholder="18 位身份证号码" maxlength="18" />
        </el-form-item>
        <el-form-item label="设置支付密码（6 位数字）" prop="payPassword">
          <el-input v-model="form.payPassword" type="password" inputmode="numeric" maxlength="6" placeholder="支付时使用" show-password />
        </el-form-item>
        <el-form-item label="确认支付密码" prop="confirm">
          <el-input v-model="form.confirm" type="password" inputmode="numeric" maxlength="6" placeholder="再次输入" show-password />
        </el-form-item>
        <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">提交认证</el-button>
        <p class="note">提交后{{ sandboxTip }}进入审核，审核通过即可使用充值/提现等功能。</p>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import axios from 'axios'
import { extractError } from '@/api/http'

const formRef = ref<FormInstance>()
const loading = ref(false)
const verified = ref(false)
const isDev = import.meta.env.DEV
const sandboxTip = computed(() =>
  isDev ? '将自动快速通过（沙箱模式），' : '由风控专员人工审核后',
)
const form = reactive({ realName: '', idCard: '', payPassword: '', confirm: '' })

const rules: FormRules = {
  realName: [
    { required: true, message: '请输入真实姓名', trigger: 'blur' },
    { min: 2, max: 30, message: '姓名长度 2-30 位', trigger: 'blur' },
  ],
  idCard: [
    { required: true, message: '请输入身份证号', trigger: 'blur' },
    { pattern: /^\d{15}(\d{2}[0-9Xx])?$/, message: '身份证号格式不正确', trigger: 'blur' },
  ],
  payPassword: [
    { required: true, message: '请设置支付密码', trigger: 'blur' },
    { pattern: /^\d{6}$/, message: '支付密码为 6 位纯数字', trigger: 'blur' },
  ],
  confirm: [
    {
      validator: (_r, v: string, cb) => {
        if (!v) cb(new Error('请再次输入支付密码'))
        else if (v !== form.payPassword) cb(new Error('两次输入不一致'))
        else cb()
      },
      trigger: 'blur',
    },
  ],
}

onMounted(async () => {
  try {
    const { data } = await axios.get('/users/me')
    verified.value = data?.realNameStatus === 'VERIFIED'
  } catch {
    /* 忽略：未登录时路由守卫会处理 */
  }
})

async function submit() {
  if (!formRef.value) return
  await formRef.value.validate()
  loading.value = true
  try {
    await axios.post('/users/verify-identity', {
      realName: form.realName.trim(),
      idCard: form.idCard.trim(),
      payPassword: form.payPassword,
    })
    ElMessage.success('实名认证已通过' + (isDev ? '（沙箱自动审核）' : '，等待审核'))
    verified.value = true
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.page { padding: 16px; }
.head h2 { margin: 4px 0 6px; font-size: 20px; }
.head p { margin: 0 0 14px; color: var(--el-text-color-secondary); font-size: 13px; }
.card { border-radius: 14px; }
.btn { width: 100%; height: 44px; margin-top: 4px; }
.note { color: var(--el-text-color-placeholder); font-size: 12px; text-align: center; margin: 10px 0 0; }
</style>
