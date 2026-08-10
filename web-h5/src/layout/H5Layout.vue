<template>
  <div class="h5">
    <header class="h5-header">
      <span>{{ title }}</span>
      <el-dropdown v-if="auth.isAuthenticated" @command="onCommand">
        <span class="h5-user"><el-icon><User /></el-icon></span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <main class="h5-main">
      <router-view />
    </main>

    <nav class="h5-nav">
      <router-link v-for="item in navs" :key="item.to" :to="item.to" class="nav-item">
        <el-icon :size="20"><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { User, Wallet, List, Present, Money } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const title = computed(() => (route.meta.title as string) || '科佰钱包')

const navs = [
  { to: '/home', label: '钱包', icon: Wallet },
  { to: '/bills', label: '账单', icon: List },
  { to: '/redpacket', label: '红包', icon: Present },
  { to: '/cashier', label: '收银台', icon: Money },
]

async function onCommand(cmd: string) {
  if (cmd === 'logout') {
    await ElMessageBox.confirm('确定退出登录？', '提示', { type: 'warning' })
    auth.logout()
    router.push('/login')
  }
}
</script>

<style scoped>
.h5 {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.h5-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: #10b981;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}
.h5-user {
  color: #fff;
  cursor: pointer;
}
.h5-main {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.h5-nav {
  display: flex;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  padding-bottom: env(safe-area-inset-bottom);
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 6px;
  font-size: 12px;
  color: #6b7280;
  text-decoration: none;
}
.nav-item.router-link-active {
  color: #10b981;
}
</style>
