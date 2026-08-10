import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const history = import.meta.env.PROD ? createWebHashHistory('/h5/') : createWebHistory()

const router = createRouter({
  history,
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
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
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.name !== 'login' && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'home' }
  return true
})

export default router
