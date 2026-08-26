<template>
  <div class="register-page">
    <div class="brand">
      <div class="brand-mark">佰</div>
      <h1>注册科佰钱包</h1>
      <p>一分钟开通，开启支付之旅</p>
    </div>
    <div class="card">
      <el-form :model="form" :rules="rules" ref="formRef" @keyup.enter="submit">
        <el-form-item prop="nickname">
          <el-input v-model="form.nickname" placeholder="昵称" size="large" />
        </el-form-item>
        <el-form-item prop="phone">
          <el-input v-model="form.phone" placeholder="手机号" size="large" maxlength="11" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="登录密码（≥8位，含大小写/数字两类）" size="large" show-password />
        </el-form-item>
        <el-form-item prop="confirm">
          <el-input v-model="form.confirm" type="password" placeholder="确认密码" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">注 册</el-button>
        <div class="alt">已有账号？<router-link to="/login">直接登录</router-link></div>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import axios from 'axios'
import { extractError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ nickname: '', phone: '', password: '', confirm: '' })

const rules: FormRules = {
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^\d{11}$/, message: '手机号格式不正确', trigger: 'blur' },
  ],
  password: [{ required: true, message: '请输入登录密码', trigger: 'blur' }],
  confirm: [
    {
      validator: (_r, v: string, cb) => {
        if (!v) cb(new Error('请再次输入密码'))
        else if (v !== form.password) cb(new Error('两次输入的密码不一致'))
        else cb()
      },
      trigger: 'blur',
    },
  ],
}

async function submit() {
  if (!formRef.value) return
  await formRef.value.validate()
  loading.value = true
  try {
    await axios.post('/auth/register', {
      nickname: form.nickname.trim(),
      phone: form.phone.trim(),
      password: form.password,
    })
    // 注册成功后自动登录，引导进入实名认证（收款前置条件）
    await auth.login({ phone: form.phone.trim(), password: form.password })
    ElMessage.success('注册成功，请先完成实名认证')
    router.push('/kyc')
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.register-page {
  min-height: 100%;
  padding: 48px 20px 24px;
  box-sizing: border-box;
  background:
    radial-gradient(80% 60% at 20% 0%, rgba(15, 169, 104, 0.22), transparent 60%),
    radial-gradient(80% 60% at 90% 90%, rgba(14, 165, 233, 0.18), transparent 60%),
    linear-gradient(160deg, #0b1220, #0f1a2e 60%, #12253a);
}
.brand { text-align: center; color: #fff; margin-bottom: 26px; }
.brand-mark { width: 60px; height: 60px; margin: 0 auto 12px; border-radius: 16px; background: linear-gradient(135deg,#0fa968,#0ea5e9); color:#fff; font-size:26px; font-weight:700; display:flex; align-items:center; justify-content:center; box-shadow: 0 12px 28px rgba(15,169,104,.4); }
.brand h1 { margin: 0; font-size: 22px; }
.brand p { margin: 5px 0 0; font-size: 13px; opacity: 0.8; }
.card { background: rgba(255,255,255,0.97); border-radius: 18px; padding: 24px 18px 18px; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
:deep(.el-form-item__content) { display: block; }
.btn { width: 100%; margin-top: 6px; height: 46px; font-size: 15px; }
.alt { text-align: center; margin-top: 14px; font-size: 13px; color: var(--el-text-color-secondary); }
.alt a { color: var(--el-color-primary); text-decoration: none; }
</style>
