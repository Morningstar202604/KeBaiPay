<template>
  <el-card shadow="never" v-loading="loading">
    <template #header>商户入驻申请</template>

    <el-alert
      v-if="merchant"
      :title="`您已提交申请，当前状态：${statusText(merchant.status)}`"
      type="info"
      :closable="false"
      style="margin-bottom: 16px"
    >
      <template #default>
        <el-button type="primary" link @click="$router.push('/merchant')">查看商户资料</el-button>
      </template>
    </el-alert>

    <el-form
      v-else
      :model="form"
      :rules="rules"
      ref="formRef"
      label-width="110px"
      style="max-width: 520px"
    >
      <el-form-item label="商户名称" prop="merchantName">
        <el-input v-model="form.merchantName" placeholder="请输入商户名称" />
      </el-form-item>
      <el-form-item label="商户类型" prop="merchantType">
        <el-radio-group v-model="form.merchantType">
          <el-radio value="PERSONAL">个人</el-radio>
          <el-radio value="ENTERPRISE">企业</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="联系人" prop="contactName">
        <el-input v-model="form.contactName" placeholder="请输入联系人" />
      </el-form-item>
      <el-form-item label="联系电话" prop="contactPhone">
        <el-input v-model="form.contactPhone" placeholder="请输入联系电话" />
      </el-form-item>
      <el-form-item label="结算账户" prop="settleAccount">
        <el-input v-model="form.settleAccount" placeholder="请输入结算银行卡号（将加密存储）" />
      </el-form-item>
      <el-form-item label="营业执照号" prop="businessLicenseNo">
        <el-input v-model="form.businessLicenseNo" placeholder="企业商户请填写（选填）" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="submit">提交入驻申请</el-button>
        <el-button @click="$router.push('/merchant')">返回</el-button>
      </el-form-item>
    </el-form>

    <el-empty v-if="!loading && !merchant && !showForm" description="加载中..." />
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import type { MerchantInfo } from '@/types'
import { fetchMerchantInfo, registerMerchant } from '@/api/modules'
import { extractError } from '@/api/http'

const loading = ref(false)
const saving = ref(false)
const merchant = ref<MerchantInfo | null>(null)
const showForm = ref(true)
const formRef = ref<FormInstance>()

const form = reactive({
  merchantName: '',
  merchantType: 'PERSONAL' as 'PERSONAL' | 'ENTERPRISE',
  contactName: '',
  contactPhone: '',
  settleAccount: '',
  businessLicenseNo: '',
})

const rules: FormRules = {
  merchantName: [{ required: true, message: '请输入商户名称', trigger: 'blur' }],
  contactName: [{ required: true, message: '请输入联系人', trigger: 'blur' }],
  contactPhone: [{ required: true, message: '请输入联系电话', trigger: 'blur' }],
  settleAccount: [{ required: true, message: '请输入结算账户', trigger: 'blur' }],
}

function statusText(s: string) {
  const map: Record<string, string> = {
    PENDING: '待审核',
    APPROVED: '已通过',
    REJECTED: '已驳回',
    SUSPENDED: '已停用',
  }
  return map[s] || s
}

async function load() {
  loading.value = true
  try {
    merchant.value = await fetchMerchantInfo()
  } catch {
    // 无商户信息（KB302/404）→ 显示注册表单
    merchant.value = null
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!formRef.value) return
  await formRef.value.validate()
  saving.value = true
  try {
    await registerMerchant({
      merchantName: form.merchantName,
      merchantType: form.merchantType,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      settleAccount: form.settleAccount,
      businessLicenseNo: form.businessLicenseNo.trim() || undefined,
    })
    ElMessage.success('入驻申请已提交，等待审核')
    await load()
  } catch (e) {
    ElMessage.error(extractError(e))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>
