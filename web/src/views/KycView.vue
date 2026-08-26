<template>
  <div class="page">
    <el-alert v-if="verified" type="success" :closable="false" show-icon title="已完成实名认证"
      description="你的账户已通过实名核验，可正常提交商户入驻与使用全部功能。" />
    <template v-else>
      <el-alert type="warning" :closable="false" show-icon class="tip"
        title="提交商户入驻前需先完成实名认证" description="依据监管要求，收款主体必须实名。信息加密存储，仅用于核验。" />
      <el-card shadow="never" class="card">
        <el-form :model="form" :rules="rules" ref="formRef" label-width="140px">
          <el-form-item label="真实姓名" prop="realName">
            <el-input v-model="form.realName" placeholder="与身份证一致" maxlength="30" style="max-width: 360px" />
          </el-form-item>
          <el-form-item label="身份证号" prop="idCard">
            <el-input v-model="form.idCard" placeholder="18 位身份证号码" maxlength="18" style="max-width: 360px" />
          </el-form-item>
          <el-form-item label="设置支付密码" prop="payPassword">
            <el-input v-model="form.payPassword" type="password" maxlength="6" placeholder="6 位纯数字，提现/退款时使用"
              show-password style="max-width: 360px" />
          </el-form-item>
          <el-form-item label="确认支付密码" prop="confirm">
            <el-input v-model="form.confirm" type="password" maxlength="6" placeholder="再次输入" show-password
              style="max-width: 360px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="loading" @click="submit">提交认证</el-button>
            <span class="note">提交后{{ sandboxTip }}生效。</span>
          </el-form-item>
        </el-form>
      </el-card>
    </template>
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
    /* 路由守卫处理未登录 */
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
.tip { margin-bottom: 14px; }
.card { border-radius: 14px; max-width: 720px; }
.note { color: var(--el-text-color-placeholder); font-size: 12px; margin-left: 10px; }
</style>
