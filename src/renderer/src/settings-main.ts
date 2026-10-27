import { createApp } from 'vue'
import { createPinia } from 'pinia'
import SettingsWindow from './components/chrome/SettingsWindow.vue'
import { i18n } from './i18n'
import { installBrowserMock } from './browser-mock'
import './assets/base.css'

/**
 * 独立设置窗口的渲染入口（settings.html）：只挂设置外壳，
 * 不加载编辑器/会话恢复/草稿等主窗口编排。主题/语言/插件等
 * 全局配置由 ui.init 从 config.json 读取，跨窗口同步走 app:configChanged。
 */
if (!window.api) installBrowserMock()

window.addEventListener('contextmenu', (e) => e.preventDefault(), true)

createApp(SettingsWindow).use(createPinia()).use(i18n).mount('#app')
