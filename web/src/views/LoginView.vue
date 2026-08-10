<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="logo" />
        <h1>科佰支付</h1>
        <p>KeBaiPay · 商户后台</p>
      </div>

      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" @keyup.enter="submit">
        <el-form-item label="手机号 / 邮箱" prop="credential">
          <el-input v-model="form.credential" placeholder="请输入手机号或邮箱" clearable>
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
          >
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" class="login-btn" :loading="loading" @click="submit">
            登 录
          </el-button>
        </el-form-item>
      </el-form>

      <div class="login-tip">
        使用已入驻商户的科佰支付用户账号登录，即可进入商户后台。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { extractError } from '@/api/http'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({
  credential: '',
  password: '',
})

const rules: FormRules = {
  credential: [{ required: true, message: '请输入手机号或邮箱', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
  ],
}

async function submit() {
  if (!formRef.value) return
  await formRef.value.validate()
  const credential = form.credential.trim()
  const body = /^\d+$/.test(credential) ? { phone: credential } : { email: credential }
  loading.value = true
  try {
    await auth.login({ ...body, password: form.password })
    ElMessage.success('登录成功')
    const redirect = (route.query.redirect as string) || '/dashboard'
    router.push(redirect)
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
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #10b981 130%);
}
.login-card {
  width: 400px;
  background: #fff;
  border-radius: 12px;
  padding: 40px 36px 24px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.login-brand {
  text-align: center;
  margin-bottom: 28px;
}
.logo {
  width: 48px;
  height: 48px;
  margin: 0 auto 8px;
  border-radius: 12px;
  background: linear-gradient(135deg, #10b981, #0ea5e9);
}
.login-brand h1 {
  margin: 0;
  font-size: 22px;
  color: #1f2937;
}
.login-brand p {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 13px;
}
.login-btn {
  width: 100%;
  height: 42px;
  font-size: 15px;
}
.login-tip {
  margin-top: 16px;
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
  line-height: 1.6;
}
</style>
