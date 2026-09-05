<template>
  <el-container class="admin">
    <el-aside width="224px" class="admin-aside">
      <div class="brand">
        <img class="brand-logo" src="/logo.svg" alt="KeBaiPay" />
        <div class="brand-text">
          <span class="brand-name">科佰支付</span>
          <span class="brand-sub">管理后台</span>
        </div>
      </div>
      <el-menu :default-active="activePath" router class="admin-menu" background-color="transparent" text-color="#94a3b8" active-text-color="#fff">
        <el-menu-item index="/dashboard"><el-icon><DataAnalysis /></el-icon><span>数据概览</span></el-menu-item>
        <el-menu-item index="/users"><el-icon><User /></el-icon><span>用户管理</span></el-menu-item>
        <el-menu-item index="/merchants"><el-icon><Shop /></el-icon><span>商户管理</span></el-menu-item>
        <el-menu-item index="/identities"><el-icon><Postcard /></el-icon><span>实名审核</span></el-menu-item>
        <el-menu-item index="/channels"><el-icon><Connection /></el-icon><span>渠道配置</span></el-menu-item>
        <el-menu-item index="/withdrawals"><el-icon><Money /></el-icon><span>提现审核</span></el-menu-item>
        <el-menu-item index="/orders"><el-icon><List /></el-icon><span>支付订单</span></el-menu-item>
        <el-menu-item index="/finance"><el-icon><DataBoard /></el-icon><span>财务总览</span></el-menu-item>
        <el-menu-item index="/risk"><el-icon><Warning /></el-icon><span>风控事件</span></el-menu-item>
        <el-menu-item index="/agents"><el-icon><MagicStick /></el-icon><span>智能体管理</span></el-menu-item>
      </el-menu>
      <div class="aside-foot">科佰支付 · 管理服务</div>
    </el-aside>

    <el-container>
      <el-header class="admin-header">
        <div>
          <div class="header-title">{{ pageTitle }}</div>
          <div class="header-sub">科佰支付 · 运营管理</div>
        </div>
        <el-dropdown @command="onCommand">
          <span class="user-chip">
            <span class="avatar"><el-icon><User /></el-icon></span>
            <span class="uname">{{ auth.username || '管理员' }}</span>
            <el-icon class="caret"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu><el-dropdown-item command="logout">退出登录</el-dropdown-item></el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="admin-main">
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
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DataAnalysis, User, Shop, Money, List, DataBoard, Warning, ArrowDown, MagicStick, Postcard, Connection } from '@element-plus/icons-vue'
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
.admin-aside {
  background: linear-gradient(180deg, #0b1220 0%, #0f1a2e 100%);
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 20px 18px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.brand-logo { width: 36px; height: 36px; border-radius: 10px; box-shadow: 0 6px 16px rgba(15,169,104,0.35); display: block; }
.brand-text { display:flex; flex-direction:column; line-height:1.25; }
.brand-name { color:#fff; font-weight:600; font-size:15px; }
.brand-sub { font-size:11px; color:#64748b; }
.admin-menu { border-right:none; flex:1; padding:12px 10px; }
.admin-menu :deep(.el-menu-item) { height:46px; line-height:46px; border-radius:10px; margin-bottom:4px; transition: background var(--kb-base) var(--kb-ease), color var(--kb-base) var(--kb-ease); }
.admin-menu :deep(.el-menu-item:hover) { background: rgba(255,255,255,0.06); color:#fff; }
.admin-menu :deep(.el-menu-item.is-active) { background: linear-gradient(135deg,rgba(15,169,104,.9),rgba(14,165,233,.8)); color:#fff; box-shadow: 0 6px 16px rgba(15,169,104,.25); }
.aside-foot { padding:14px 18px; font-size:11px; color:#475569; border-top:1px solid rgba(255,255,255,0.06); }

.admin-header { display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,.85); backdrop-filter: blur(8px); border-bottom:1px solid var(--el-border-color-lighter); height:64px; padding:0 24px; }
.header-title { font-size:17px; font-weight:700; color:var(--el-text-color-primary); }
.header-sub { font-size:12px; color:var(--el-text-color-placeholder); margin-top:1px; }
.user-chip { display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--el-text-color-regular); padding:6px 10px; border-radius:10px; transition:background var(--kb-fast) var(--kb-ease); }
.user-chip:hover { background: var(--el-fill-color-light); }
.avatar { width:30px; height:30px; border-radius:50%; background:linear-gradient(135deg,#0fa968,#0ea5e9); color:#fff; display:flex; align-items:center; justify-content:center; }
.uname { font-weight:500; font-size:14px; }
.caret { font-size:12px; color:var(--el-text-color-placeholder); }

.admin-main { padding:24px; overflow-y:auto; }
</style>
