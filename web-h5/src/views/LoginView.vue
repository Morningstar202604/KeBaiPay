<template>
  <div class="login-page">
    <div class="brand">
      <div class="brand-mark">佰</div>
      <h1>科佰钱包</h1>
      <p>KeBaiPay 用户端</p>
    </div>
    <div class="login-card">
      <el-form :model="form" :rules="rules" ref="formRef" @keyup.enter="submit">
        <el-form-item prop="credential">
          <el-input v-model="form.credential" placeholder="手机号 / 邮箱" size="large" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <div v-if="isDev" class="tip">测试账号：13800000001 / Abc12345（仅开发环境显示，生产环境请修改种子口令）</div>
      <div class="alt">还没有账号？<router-link to="/register">立即注册</router-link></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const isDev = import.meta.env.DEV
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { extractError } from '@/api/http'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ credential: '', password: '' })
const rules: FormRules = {
  credential: [{ required: true, message: '请输入手机号或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function submit() {
  if (!formRef.value) return
  await formRef.value.validate()
  const c = form.credential.trim()
  const body = /^\d+$/.test(c) ? { phone: c } : { email: c }
  loading.value = true
  try {
    await auth.login({ ...body, password: form.password })
    ElMessage.success('登录成功')
    router.push((route.query.redirect as string) || '/home')
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100%;
  padding: 56px 20px 24px;
  box-sizing: border-box;
  background:
    radial-gradient(80% 60% at 20% 0%, rgba(15, 169, 104, 0.22), transparent 60%),
    radial-gradient(80% 60% at 90% 90%, rgba(14, 165, 233, 0.18), transparent 60%),
    linear-gradient(160deg, #0b1220, #0f1a2e 60%, #12253a);
}
.brand { text-align: center; color: #fff; margin-bottom: 30px; }
.brand-mark { width: 60px; height: 60px; margin: 0 auto 12px; border-radius: 16px; background: linear-gradient(135deg,#0fa968,#0ea5e9); color:#fff; font-size:26px; font-weight:700; display:flex; align-items:center; justify-content:center; box-shadow: 0 12px 28px rgba(15,169,104,.4); }
.brand h1 { margin: 0; font-size: 24px; }
.brand p { margin: 5px 0 0; font-size: 13px; opacity: 0.8; }
.login-card { background: rgba(255,255,255,0.97); border-radius: 18px; padding: 24px 18px 18px; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
:deep(.el-form-item__content) { display: block; }
.btn { width: 100%; margin-top: 6px; height: 46px; font-size: 15px; }
.tip { text-align: center; color: var(--el-text-color-placeholder); margin-top: 16px; font-size: 12px; }
.alt { text-align: center; margin-top: 12px; font-size: 13px; }
.alt a { color: var(--el-color-primary); text-decoration: none; font-weight: 600; }
</style>
