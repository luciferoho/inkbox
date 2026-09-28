import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/base.css'

/**
 * 浏览器直接访问 dev server（无 Electron preload）时的最小 mock，
 * 仅用于 UI 开发与可视化验证；Electron 内运行时 window.api 由 preload 提供。
 */
function installBrowserMock(): void {
  const cfg = {
    theme: 'light' as const,
    editor: { fontSize: 16, lineHeight: 1.7, pageWidthPct: 80 },
    autosave: { enabled: true, intervalMs: 15000 },
    sidebarWidth: 264,
    recent: [] as { path: string; ts: number }[]
  }
  window.api = {
    fs: {
      readFile: async () => '',
      writeFile: async () => undefined,
      writeFileBinary: async () => undefined,
      create: async () => undefined,
      rename: async () => undefined,
      delete: async () => undefined,
      readDir: async () => []
    },
    dialog: {
      openFile: async () => null,
      openFolder: async () => null,
      saveFile: async () => null
    },
    app: {
      getConfig: async () => cfg,
      setConfig: async (patch: Record<string, unknown>) => Object.assign(cfg, patch) as typeof cfg
    },
    win: {
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      close: () => undefined
    },
    onMenuCommand: () => () => undefined,
    onWinState: () => () => undefined
  }
}

if (!window.api) installBrowserMock()

createApp(App).use(createPinia()).mount('#app')
