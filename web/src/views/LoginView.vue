<template>
  <div class="login-page">
    <div class="login-card">
      <div class="brand">
        <div class="brand-mark">佰</div>
        <h1>科佰支付</h1>
        <p>商户服务中台 · 安全资金服务</p>
      </div>

      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" @keyup.enter="submit">
        <el-form-item label="手机号 / 邮箱" prop="credential">
          <el-input v-model="form.credential" placeholder="请输入手机号或邮箱" clearable size="large">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" show-password>
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="submit">登 录</el-button>
      </el-form>

      <div class="login-foot">
        <span class="line" />
        <span class="foot-text">使用已入驻的科佰支付账号登录</span>
        <span class="line" />
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
const form = reactive({ credential: '', password: '' })
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
    router.push((route.query.redirect as string) || '/dashboard')
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
    radial-gradient(60% 60% at 20% 10%, rgba(15, 169, 104, 0.10), transparent 60%),
    radial-gradient(60% 60% at 85% 85%, rgba(14, 165, 233, 0.10), transparent 60%),
    linear-gradient(160deg, #0b1220 0%, #0f1a2e 60%, #12253a 100%);
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
  width: 400px;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 20px;
  padding: 40px 36px 26px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
}
.brand { text-align: center; margin-bottom: 28px; }
.brand-mark {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0fa968, #0ea5e9);
  color: #fff;
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 24px rgba(15, 169, 104, 0.35);
}
.brand h1 { margin: 0; font-size: 22px; color: var(--el-text-color-primary); }
.brand p { margin: 4px 0 0; color: var(--el-text-color-placeholder); font-size: 13px; }
:deep(.el-form-item__label) { color: var(--el-text-color-secondary); font-weight: 500; }
.login-btn { width: 100%; height: 46px; font-size: 15px; margin-top: 4px; }
.login-foot { display: flex; align-items: center; gap: 10px; margin-top: 22px; }
.line { flex: 1; height: 1px; background: var(--el-border-color-lighter); }
.foot-text { font-size: 12px; color: var(--el-text-color-placeholder); white-space: nowrap; }
</style>
