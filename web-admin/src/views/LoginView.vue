<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="brand-mark">佰</div>
        <h1>科佰支付</h1>
        <p>管理后台</p>
      </div>
      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" @keyup.enter="submit">
        <el-form-item label="用户名" prop="username"><el-input v-model="form.username" placeholder="admin" size="large" /></el-form-item>
        <el-form-item label="密码" prop="password"><el-input v-model="form.password" type="password" show-password size="large" /></el-form-item>
        <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <div v-if="isDev" class="tip">测试账号：admin / Admin2026（仅开发环境显示，生产环境请修改种子口令）</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

const isDev = import.meta.env.DEV
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { extractError } from '@/api/http'

const router = useRouter()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ username: '', password: '' })
const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function submit() {
  if (!formRef.value) return
  await formRef.value.validate()
  loading.value = true
  try {
    await auth.login(form)
    ElMessage.success('登录成功')
    router.push('/dashboard')
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background:
    radial-gradient(60% 60% at 20% 10%, rgba(15, 169, 104, 0.12), transparent 60%),
    radial-gradient(60% 60% at 85% 85%, rgba(14, 165, 233, 0.12), transparent 60%),
    linear-gradient(160deg, #0b1220, #0f1a2e 60%, #12253a);
}
.login-page::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 22px 22px;
  opacity: 0.4;
}
.login-card {
  position: relative;
  width: 380px;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 20px;
  padding: 38px 34px 24px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
}
.brand { text-align: center; margin-bottom: 26px; }
.brand-mark { width: 52px; height: 52px; margin: 0 auto 10px; border-radius: 14px; background: linear-gradient(135deg,#0fa968,#0ea5e9); color:#fff; font-size:22px; font-weight:700; display:flex; align-items:center; justify-content:center; box-shadow: 0 10px 24px rgba(15,169,104,.35); }
.brand h1 { margin: 0; font-size: 21px; color: var(--el-text-color-primary); }
.brand p { margin: 4px 0 0; color: var(--el-text-color-placeholder); font-size: 13px; }
:deep(.el-form-item__label) { color: var(--el-text-color-secondary); font-weight: 500; }
.btn { width: 100%; height: 46px; font-size: 15px; margin-top: 4px; }
.tip { margin-top: 18px; text-align: center; font-size: 12px; color: var(--el-text-color-placeholder); }
</style>
