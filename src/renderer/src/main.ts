import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n } from './i18n'
import { installBrowserMock } from './browser-mock'
import './assets/base.css'

if (!window.api) installBrowserMock()

/* 全局禁用默认右键菜单：内容区不再弹 Chromium 菜单，标题栏拖拽区不再弹系统
   菜单（还原/移动/大小…）。自绘菜单（标签栏等）自己监听 contextmenu 弹自定义
   面板——这里只 preventDefault、不阻断传播，互不影响。 */
window.addEventListener('contextmenu', (e) => e.preventDefault(), true)

createApp(App).use(createPinia()).use(i18n).mount('#app')
