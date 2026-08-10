<template>
  <el-container class="admin">
    <el-aside width="220px" class="admin-aside">
      <div class="brand"><span class="dot" /><span>科佰支付 · 管理</span></div>
      <el-menu :default-active="activePath" router class="admin-menu" background-color="#111827" text-color="#9ca3af" active-text-color="#fff">
        <el-menu-item index="/dashboard"><el-icon><DataAnalysis /></el-icon><span>数据概览</span></el-menu-item>
        <el-menu-item index="/users"><el-icon><User /></el-icon><span>用户管理</span></el-menu-item>
        <el-menu-item index="/merchants"><el-icon><Shop /></el-icon><span>商户管理</span></el-menu-item>
        <el-menu-item index="/withdrawals"><el-icon><Money /></el-icon><span>提现审核</span></el-menu-item>
        <el-menu-item index="/orders"><el-icon><List /></el-icon><span>支付订单</span></el-menu-item>
        <el-menu-item index="/finance"><el-icon><DataBoard /></el-icon><span>财务总览</span></el-menu-item>
        <el-menu-item index="/risk"><el-icon><Warning /></el-icon><span>风控事件</span></el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="admin-header">
        <span class="title">{{ pageTitle }}</span>
        <el-dropdown @command="onCommand">
          <span class="user-chip"><el-icon><User /></el-icon> {{ auth.username || '管理员' }}<el-icon><ArrowDown /></el-icon></span>
          <template #dropdown>
            <el-dropdown-menu><el-dropdown-item command="logout">退出登录</el-dropdown-item></el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="admin-main"><router-view /></el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DataAnalysis, User, Shop, Money, List, DataBoard, Warning, ArrowDown } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const activePath = computed(() => route.path)
const pageTitle = computed(() => (route.meta.title as string) || '管理后台')

async function onCommand(cmd: string) {
  if (cmd === 'logout') {
    await ElMessageBox.confirm('确定退出登录？', '提示', { type: 'warning' })
    auth.logout()
    router.push('/login')
  }
}
</script>

<style scoped>
.admin { height: 100%; }
.admin-aside { background: #111827; }
.brand { height: 56px; display: flex; align-items: center; gap: 8px; padding: 0 20px; color: #fff; font-weight: 600; border-bottom: 1px solid rgba(255,255,255,0.08); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #6366f1; }
.admin-menu { border-right: none; }
.admin-menu :deep(.el-menu-item.is-active) { background: #6366f1; color: #fff; }
.admin-header { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #e5e7eb; }
.title { font-size: 16px; font-weight: 600; color: #1f2937; }
.user-chip { display: flex; align-items: center; gap: 6px; cursor: pointer; color: #374151; }
.admin-main { padding: 20px; }
</style>
