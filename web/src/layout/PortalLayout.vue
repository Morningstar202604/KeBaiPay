<template>
  <el-container class="portal">
    <el-aside width="220px" class="portal-aside">
      <div class="brand">
        <span class="brand-dot" />
        <span>科佰支付</span>
      </div>
      <el-menu
        :default-active="activePath"
        router
        class="portal-menu"
        background-color="#1f2937"
        text-color="#cbd5e1"
        active-text-color="#ffffff"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>数据看板</span>
        </el-menu-item>
        <el-menu-item index="/orders">
          <el-icon><List /></el-icon>
          <span>订单管理</span>
        </el-menu-item>
        <el-menu-item index="/reconciliation">
          <el-icon><DocumentChecked /></el-icon>
          <span>对账查询</span>
        </el-menu-item>
        <el-menu-item index="/qrcodes">
          <el-icon><Grid /></el-icon>
          <span>收款码</span>
        </el-menu-item>
        <el-menu-item index="/apps">
          <el-icon><Key /></el-icon>
          <span>应用管理</span>
        </el-menu-item>
        <el-menu-item index="/merchant">
          <el-icon><Shop /></el-icon>
          <span>商户资料</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="portal-header">
        <div class="header-title">{{ pageTitle }}</div>
        <el-dropdown @command="onCommand">
          <span class="user-chip">
            <el-icon><User /></el-icon>
            <span>{{ auth.userId ? '商户' : '未登录' }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <el-main class="portal-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  DataAnalysis, List, DocumentChecked, Grid, Key, Shop, User, ArrowDown,
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const activePath = computed(() => route.path)
const pageTitle = computed(() => (route.meta.title as string) || '商户后台')

async function onCommand(cmd: string) {
  if (cmd === 'logout') {
    await ElMessageBox.confirm('确定退出登录？', '提示', { type: 'warning' })
    auth.logout()
    router.push('/login')
  }
}
</script>

<style scoped>
.portal {
  height: 100%;
}
.portal-aside {
  background: #1f2937;
  color: #cbd5e1;
  overflow-x: hidden;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  color: #fff;
  font-weight: 600;
  font-size: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #10b981;
}
.portal-menu {
  border-right: none;
}
.portal-menu :deep(.el-menu-item) {
  height: 48px;
  line-height: 48px;
}
.portal-menu :deep(.el-menu-item.is-active) {
  background: #10b981;
}
.portal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #374151;
}
.portal-main {
  padding: 20px;
}
</style>
