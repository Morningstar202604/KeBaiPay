import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 路由 base 与构建 base 保持一致：默认服务器子路径 /h5/，
// 安卓包构建时 VITE_APP_BASE=/ 覆盖（Capacitor WebView 从根路径加载）
const routeBase = import.meta.env.VITE_APP_BASE || (import.meta.env.PROD ? '/h5/' : '/')
const history = import.meta.env.PROD ? createWebHashHistory(routeBase) : createWebHistory(routeBase)

const router = createRouter({
  history,
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    { path: '/register', name: 'register', component: () => import('@/views/RegisterView.vue') },
    {
      path: '/',
      component: () => import('@/layout/H5Layout.vue'),
      children: [
        { path: 'home', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { title: '钱包' } },
        { path: 'recharge', name: 'recharge', component: () => import('@/views/RechargeView.vue'), meta: { title: '充值' } },
        { path: 'transfer', name: 'transfer', component: () => import('@/views/TransferView.vue'), meta: { title: '转账' } },
        { path: 'withdraw', name: 'withdraw', component: () => import('@/views/WithdrawView.vue'), meta: { title: '提现' } },
        { path: 'redpacket', name: 'redpacket', component: () => import('@/views/RedPacketView.vue'), meta: { title: '红包' } },
        { path: 'bills', name: 'bills', component: () => import('@/views/BillsView.vue'), meta: { title: '账单' } },
        { path: 'cashier', name: 'cashier', component: () => import('@/views/CashierView.vue'), meta: { title: '收银台' } },
        { path: 'kyc', name: 'kyc', component: () => import('@/views/KycView.vue'), meta: { title: '实名认证' } },
        { path: 'agent', name: 'agent', component: () => import('@/views/AgentChatView.vue'), meta: { title: 'AI 助手' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  // login / register 为匿名可达页；其余页面未登录一律回登录页（此前 register 被误拦导致注册页不可达）
  if (to.name !== 'login' && to.name !== 'register' && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'home' }
  return true
})

export default router

// 浏览器标签页标题随路由更新（P2-7）
router.afterEach((to) => {
  const t = (to.meta?.title as string | undefined) || ''
  document.title = t ? '科佰钱包' + ' · ' + t : '科佰钱包'
})
