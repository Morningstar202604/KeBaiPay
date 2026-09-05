<template>
  <div class="h5">
    <header class="h5-header">
      <div class="h5-brand">
        <img class="brand-logo" src="/logo.svg" alt="KeBaiPay" />
        <span>{{ title }}</span>
      </div>
      <el-dropdown v-if="auth.isAuthenticated" @command="onCommand">
        <span class="h5-user"><el-icon><User /></el-icon></span>
        <template #dropdown>
          <el-dropdown-menu><el-dropdown-item command="logout">退出登录</el-dropdown-item></el-dropdown-menu>
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
import { User, Wallet, List, Present, Money, MagicStick } from '@element-plus/icons-vue'
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
  { to: '/agent', label: 'AI助手', icon: MagicStick },
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
.h5 { height: 100%; display: flex; flex-direction: column; }
.h5-header {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: linear-gradient(135deg, #0b1220, #0f1a2e);
  color: #fff;
  position: sticky;
  top: 0;
  z-index: 10;
}
.h5-brand { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; }
.brand-logo { width: 26px; height: 26px; border-radius: 7px; display: block; box-shadow: 0 2px 8px rgba(15,169,104,.4); }
.h5-user { color: #fff; cursor: pointer; display: flex; align-items: center; }
.h5-main { flex: 1; overflow-y: auto; padding: 14px; padding-bottom: 90px; }
.h5-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  border-top: 1px solid var(--el-border-color-lighter);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  padding: 6px 0;
  padding-bottom: calc(6px + env(safe-area-inset-bottom));
  z-index: 10;
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0 4px;
  font-size: 11px;
  color: #64748b;
  text-decoration: none;
  gap: 2px;
  transition: color var(--kb-base) var(--kb-ease), transform var(--kb-base) var(--kb-ease);
}
.nav-item.router-link-active { color: #0c8a57; }
.nav-item.router-link-active :deep(.el-icon) { transform: translateY(-1px); }
.nav-item:active { transform: scale(0.94); }
</style>

/* 平板/宽屏限宽（P0-4）：内容居中 520px，底部导航同步居中 */
@media (min-width: 768px) {
  .h5-header, .h5-main { max-width: 520px; margin-left: auto; margin-right: auto; width: 100%; }
  .h5-nav { max-width: 520px; left: 50%; transform: translateX(-50%); border-radius: 16px 16px 0 0; }
}
