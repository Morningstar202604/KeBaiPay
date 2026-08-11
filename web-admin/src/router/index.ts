import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const history = import.meta.env.PROD ? createWebHashHistory('/admin/') : createWebHistory()

const router = createRouter({
  history,
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', name: 'admin-login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/',
      component: () => import('@/layout/AdminLayout.vue'),
      children: [
        { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '数据概览' } },
        { path: 'users', name: 'users', component: () => import('@/views/UsersView.vue'), meta: { title: '用户管理' } },
        { path: 'merchants', name: 'merchants', component: () => import('@/views/MerchantsView.vue'), meta: { title: '商户管理' } },
        { path: 'withdrawals', name: 'withdrawals', component: () => import('@/views/WithdrawalsView.vue'), meta: { title: '提现审核' } },
        { path: 'orders', name: 'orders', component: () => import('@/views/OrdersView.vue'), meta: { title: '支付订单' } },
        { path: 'finance', name: 'finance', component: () => import('@/views/FinanceView.vue'), meta: { title: '财务总览' } },
        { path: 'risk', name: 'risk', component: () => import('@/views/RiskEventsView.vue'), meta: { title: '风控事件' } },
        { path: 'agents', name: 'agents', component: () => import('@/views/AgentView.vue'), meta: { title: '智能体管理' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.name !== 'admin-login' && !auth.isAuthenticated) {
    return { name: 'admin-login' }
  }
  if (to.name === 'admin-login' && auth.isAuthenticated) return { name: 'dashboard' }
  return true
})

export default router
