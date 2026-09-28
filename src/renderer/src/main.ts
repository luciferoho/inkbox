import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/base.css'

/**
 * 浏览器直接访问 dev server（无 Electron preload）时的最小 mock，
 * 仅用于 UI 开发与可视化验证；Electron 内运行时 window.api 由 preload 提供。
 * 内存虚拟文件系统 + 可手动触发的外部修改回调，便于浏览器里做端到端验证。
 */
function installBrowserMock(): void {
  const cfg = {
    theme: 'light' as const,
    editor: { fontSize: 16, lineHeight: 1.7, pageWidthPct: 80 },
    autosave: { enabled: true, intervalMs: 15000 },
    sidebarWidth: 264,
    recent: [] as { path: string; ts: number }[]
  }
  const files = new Map<string, string>()
  const fileChangedListeners = new Set<(p: { path: string }) => void>()
  window.api = {
    fs: {
      readFile: async (path: string) => files.get(path) ?? '',
      writeFile: async (path: string, content: string) => void files.set(path, content),
      writeFileBinary: async () => undefined,
      readBinary: async () => {
        throw new Error('mock: no binary')
      },
      create: async () => undefined,
      rename: async (o: string, n: string) => {
        const c = files.get(o)
        if (c !== undefined) {
          files.set(n, c)
          files.delete(o)
        }
      },
      delete: async (path: string) => void files.delete(path),
      readDir: async () => []
    },
    dialog: {
      openFile: async () => null,
      openFolder: async () => null,
      saveFile: async () => null
    },
    export: {
      pdf: async () => null,
      previewPdf: async () => {
        throw new Error('mock: PDF 预览仅在应用内可用')
      }
    },
    drafts: {
      // localStorage 背书：草稿恢复的端到端验证可跨页面重载
      save: async (id: number, payload: unknown) =>
        localStorage.setItem(`mock-draft-${id}`, JSON.stringify(payload)),
      list: async () =>
        Object.entries(localStorage)
          .filter(([k]) => k.startsWith("mock-draft-"))
          .map(([, v]) => JSON.parse(v) as import('@shared/types').DraftPayload),
      clear: async (id: number) => localStorage.removeItem(`mock-draft-${id}`),
      clearAll: async () => {
        for (const k of Object.keys(localStorage).filter((k) => k.startsWith("mock-draft-")))
          localStorage.removeItem(k)
      }
    },
    watch: {
      watch: () => undefined,
      unwatch: () => undefined,
      onFileChanged: (cb: (p: { path: string }) => void) => {
        fileChangedListeners.add(cb)
        return () => fileChangedListeners.delete(cb)
      }
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
  // 验证辅助：往"磁盘"写文件并触发外部修改回调
  ;(window as unknown as Record<string, unknown>).__mockFs = {
    write: (path: string, content: string) => {
      files.set(path, content)
      for (const cb of fileChangedListeners) cb({ path })
    },
    files
  }
}

if (!window.api) installBrowserMock()

createApp(App).use(createPinia()).mount('#app')
