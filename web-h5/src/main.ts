import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 组件样式由 unplugin-vue-components 按需注入；
// ElMessage/ElMessageBox 是函数式调用（非模板组件），样式需手动补齐
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import '@/styles/design-system.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
