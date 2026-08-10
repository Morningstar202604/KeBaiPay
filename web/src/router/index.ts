import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// 生产由 NestJS 托管在 /portal 下，使用 hash 路由避免刷新 404
const history = import.meta.env.PROD ? createWebHashHistory('/portal/') : createWebHistory()

const router = createRouter({
  history,
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/',
      component: () => import('@/layout/PortalLayout.vue'),
      children: [
        { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '数据看板' } },
        { path: 'orders', name: 'orders', component: () => import('@/views/OrdersView.vue'), meta: { title: '订单管理' } },
        { path: 'reconciliation', name: 'reconciliation', component: () => import('@/views/ReconciliationView.vue'), meta: { title: '对账查询' } },
        { path: 'qrcodes', name: 'qrcodes', component: () => import('@/views/QrCodesView.vue'), meta: { title: '收款码' } },
        { path: 'apps', name: 'apps', component: () => import('@/views/AppsView.vue'), meta: { title: '应用管理' } },
        { path: 'merchant', name: 'merchant', component: () => import('@/views/MerchantInfoView.vue'), meta: { title: '商户资料' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.name !== 'login' && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: 'dashboard' }
  }
  return true
})

export default router
