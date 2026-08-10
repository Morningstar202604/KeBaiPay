<template>
  <div class="login-page">
    <div class="card">
      <h1>科佰支付</h1>
      <p>管理后台</p>
      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" @keyup.enter="submit">
        <el-form-item label="用户名" prop="username"><el-input v-model="form.username" placeholder="admin" /></el-form-item>
        <el-form-item label="密码" prop="password"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        <el-button type="primary" class="btn" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <div class="tip">测试账号：admin / Admin2026</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
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
.login-page { height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #111827, #6366f1); }
.card { width: 360px; background: #fff; border-radius: 12px; padding: 32px; text-align: center; }
.card h1 { margin: 0; font-size: 22px; color: #1f2937; }
.card p { margin: 4px 0 20px; color: #9ca3af; }
:deep(.el-form-item__content) { display: block; }
.btn { width: 100%; margin-top: 8px; }
.tip { margin-top: 16px; font-size: 12px; color: #9ca3af; }
</style>
