<template>
  <div class="login-page">
    <div class="brand">
      <div class="logo" />
      <h1>科佰钱包</h1>
      <p>KeBaiPay 用户端</p>
    </div>
    <el-form :model="form" :rules="rules" ref="formRef" label-position="top" @keyup.enter="submit">
      <el-form-item prop="credential">
        <el-input v-model="form.credential" placeholder="手机号 / 邮箱" size="large" />
      </el-form-item>
      <el-form-item prop="password">
        <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password />
      </el-form-item>
      <el-button type="primary" size="large" class="btn" :loading="loading" @click="submit">登 录</el-button>
    </el-form>
    <div class="tip">测试账号：13800000001 / Abc12345</div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
  height: 100%;
  padding: 48px 24px;
  background: linear-gradient(160deg, #0f172a, #10b981);
  box-sizing: border-box;
}
.brand {
  text-align: center;
  color: #fff;
  margin-bottom: 32px;
}
.logo {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.2);
}
.brand h1 { margin: 0; font-size: 24px; }
.brand p { margin: 4px 0 0; font-size: 13px; opacity: 0.8; }
:deep(.el-form-item__content) { display: block; }
.btn { width: 100%; margin-top: 8px; }
.tip { text-align: center; color: rgba(255,255,255,0.8); margin-top: 20px; font-size: 12px; }
</style>
