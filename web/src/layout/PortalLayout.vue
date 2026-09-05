<template>
  <el-container class="portal">
    <el-aside :width="isCollapse ? '64px' : '224px'" class="portal-aside">
      <div class="brand">
        <img class="brand-logo" src="/logo.svg" alt="KeBaiPay" />
        <div class="brand-text" v-show="!isCollapse">
          <span class="brand-name">科佰支付</span>
          <span class="brand-sub">KeBaiPay · 商户</span>
        </div>
      </div>

      <el-menu :default-active="activePath" router :collapse="isCollapse" :collapse-transition="false" class="portal-menu" background-color="transparent" text-color="#94a3b8" active-text-color="#fff">
        <el-menu-item index="/dashboard"><el-icon><DataAnalysis /></el-icon><span>数据看板</span></el-menu-item>
        <el-menu-item index="/orders"><el-icon><List /></el-icon><span>订单管理</span></el-menu-item>
        <el-menu-item index="/reconciliation"><el-icon><DocumentChecked /></el-icon><span>对账查询</span></el-menu-item>
        <el-menu-item index="/qrcodes"><el-icon><Grid /></el-icon><span>收款码</span></el-menu-item>
        <el-menu-item index="/apps"><el-icon><Key /></el-icon><span>应用管理</span></el-menu-item>
        <el-menu-item index="/kyc"><el-icon><Postcard /></el-icon><span>实名认证</span></el-menu-item>
        <el-menu-item index="/merchant"><el-icon><Shop /></el-icon><span>商户资料</span></el-menu-item>
      </el-menu>

      <div class="aside-foot">科佰支付 · 商户服务中台</div>
    </el-aside>

    <el-container>
      <el-header class="portal-header">
        <div class="header-left">
          <el-icon class="collapse-toggle" @click="toggleCollapse" :title="isCollapse ? '展开菜单' : '收起菜单'">
            <Expand v-if="isCollapse" />
            <Fold v-else />
          </el-icon>
          <div>
            <div class="header-title">{{ pageTitle }}</div>
            <div class="header-sub">科佰支付 · 安全资金服务</div>
          </div>
        </div>
        <el-dropdown @command="onCommand">
          <span class="user-chip">
            <span class="avatar"><el-icon><User /></el-icon></span>
            <span class="uname">{{ auth.userId ? '商户' : '未登录' }}</span>
            <el-icon class="caret"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <el-main class="portal-main">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DataAnalysis, List, DocumentChecked, Grid, Key, Shop, User, ArrowDown, Postcard, Expand, Fold } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const activePath = computed(() => route.path)
const pageTitle = computed(() => (route.meta.title as string) || '商户后台')

// 响应式：窄屏自动收起侧边栏为图标模式（P0-4，与管理后台一致）
const isCollapse = ref(false)
function syncCollapse() {
  isCollapse.value = window.innerWidth < 1280
}
function toggleCollapse() {
  isCollapse.value = !isCollapse.value
}
let onResize: () => void
onMounted(() => {
  syncCollapse()
  onResize = syncCollapse
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

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
  background: linear-gradient(180deg, #0b1220 0%, #0f1a2e 100%);
  color: #cbd5e1;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 18px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.brand-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  box-shadow: 0 6px 16px rgba(15, 169, 104, 0.35);
  display: block;
}
.brand-text { display: flex; flex-direction: column; line-height: 1.25; }
.brand-name { color: #fff; font-weight: 600; font-size: 15px; }
.brand-sub { font-size: 11px; color: #64748b; }

.portal-menu {
  border-right: none;
  flex: 1;
  padding: 12px 10px;
}
.portal-menu :deep(.el-menu-item) {
  height: 46px;
  line-height: 46px;
  border-radius: 10px;
  margin-bottom: 4px;
  transition: background var(--kb-base) var(--kb-ease), color var(--kb-base) var(--kb-ease), transform var(--kb-base) var(--kb-ease);
}
.portal-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.portal-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(135deg, rgba(15, 169, 104, 0.9), rgba(14, 165, 233, 0.8));
  color: #fff;
  box-shadow: 0 6px 16px rgba(15, 169, 104, 0.25);
}
.aside-foot {
  padding: 14px 18px;
  font-size: 11px;
  color: #475569;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.portal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--el-border-color-lighter);
  height: 64px;
  padding: 0 24px;
}
.header-left { display: flex; align-items: center; gap: 14px; }
.collapse-toggle { font-size: 19px; cursor: pointer; color: var(--el-text-color-secondary); transition: color 0.15s ease; }
.collapse-toggle:hover { color: var(--el-color-primary); }
.header-title { font-size: 17px; font-weight: 700; color: var(--el-text-color-primary); }
.header-sub { font-size: 12px; color: var(--el-text-color-placeholder); margin-top: 1px; }

.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--el-text-color-regular);
  padding: 6px 10px;
  border-radius: 10px;
  transition: background var(--kb-fast) var(--kb-ease);
}
.user-chip:hover { background: var(--el-fill-color-light); }
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0fa968, #0ea5e9);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.uname { font-weight: 500; font-size: 14px; }
.caret { font-size: 12px; color: var(--el-text-color-placeholder); }

.portal-main {
  padding: 24px;
  overflow-y: auto;
}
</style>
