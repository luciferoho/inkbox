import { createApp } from 'vue'
import { createPinia } from 'pinia'
import type { AppConfig } from '@shared/types'
import App from './App.vue'
import { i18n } from './i18n'
import './assets/base.css'

/**
 * 浏览器直接访问 dev server（无 Electron preload）时的最小 mock，
 * 仅用于 UI 开发与可视化验证；Electron 内运行时 window.api 由 preload 提供。
 * 内存虚拟文件系统 + 可手动触发的外部修改回调，便于浏览器里做端到端验证。
 */
function installBrowserMock(): void {
  // config 持久化到 localStorage：浏览器里验证设置开关跨重载生效
  const cfg: AppConfig = {
    theme: 'light' as const,
    locale: 'system' as const,
    editor: { fontSize: 16, lineHeight: 1.7, pageWidthPct: 80 },
    autosave: { enabled: true, intervalMs: 15000 },
    restoreTabs: true,
    restoreFolders: true,
    closeAction: 'quit' as const,
    sidebarWidth: 264,
    recent: [] as { path: string; ts: number }[]
  }
  try {
    const saved = localStorage.getItem('mock-cfg')
    if (saved) Object.assign(cfg, JSON.parse(saved))
  } catch {
    /* 损坏即用默认值 */
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
      save: async (key: string, payload: unknown) =>
        localStorage.setItem(`mock-draft-${key}`, JSON.stringify(payload)),
      list: async () =>
        Object.entries(localStorage)
          .filter(([k]) => k.startsWith("mock-draft-"))
          .map(([k, v]) => ({
            key: k.slice("mock-draft-".length),
            draft: JSON.parse(v) as import('@shared/types').DraftPayload
          })),
      clear: async (key: string) => localStorage.removeItem(`mock-draft-${key}`),
      clearAll: async () => {
        for (const k of Object.keys(localStorage).filter((k) => k.startsWith("mock-draft-")))
          localStorage.removeItem(k)
      }
    },
    drag: {
      begin: (doc: import('@shared/types').DetachDoc) => {
        ;(window as unknown as { __mockDrag: import('@shared/types').DetachDoc | null })
          .__mockDrag = doc
      },
      end: () => {
        ;(window as unknown as { __mockDrag: import('@shared/types').DetachDoc | null })
          .__mockDrag = null
      },
      take: async () => {
        const w = window as unknown as { __mockDrag: import('@shared/types').DetachDoc | null }
        const doc = w.__mockDrag ?? null
        w.__mockDrag = null
        return doc
      },
      onConsumed: () => () => undefined
    },
    doc: {
      tryOpen: async (path: string) => {
        const w = window as unknown as { __mockDocOwners?: Record<string, number> }
        w.__mockDocOwners ??= {}
        const owner = w.__mockDocOwners[path]
        if (owner !== undefined && owner !== 1) return 'elsewhere' as const
        w.__mockDocOwners[path] = 1
        return 'ok' as const
      },
      acquire: (path: string) => {
        const w = window as unknown as { __mockDocOwners?: Record<string, number> }
        w.__mockDocOwners ??= {}
        if (path) w.__mockDocOwners[path] = 1
      },
      release: (path: string) => {
        const w = window as unknown as { __mockDocOwners?: Record<string, number> }
        if (path) delete w.__mockDocOwners?.[path]
      },
      onActivateTab: () => () => undefined
    },
    session: {
      // localStorage 背书，浏览器里可端到端验证启动恢复
      save: async (key: string, payload: unknown) =>
        localStorage.setItem(`mock-session-${key}`, JSON.stringify(payload)),
      load: async () =>
        Object.entries(localStorage)
          .filter(([k]) => k.startsWith("mock-session-"))
          .map(([k, v]) => ({
            key: k.slice("mock-session-".length),
            session: JSON.parse(v) as import('@shared/types').SessionPayload
          })),
      clearOthers: async (keepKey: string) => {
        for (const k of Object.keys(localStorage).filter((k) => k.startsWith("mock-session-")))
          if (k !== `mock-session-${keepKey}`) localStorage.removeItem(k)
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
      setConfig: async (patch: Partial<AppConfig>) => {
        Object.assign(cfg, patch)
        localStorage.setItem('mock-cfg', JSON.stringify(cfg))
        return cfg as AppConfig
      },
      setLocale: async () => undefined
    },
    win: {
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      close: () => undefined,
      // 浏览器验证：记录 detach 载荷（window.__mockDetached）
      openDoc: (doc: import('@shared/types').DetachDoc) => {
        ;(window as unknown as { __mockDetached: import('@shared/types').DetachDoc[] })
          .__mockDetached ??= []
        ;(window as unknown as { __mockDetached: import('@shared/types').DetachDoc[] })
          .__mockDetached.push(doc)
      },
      takeInitialDoc: async () => ({
        windowKey: 'w1',
        doc: null,
        crashed: localStorage.getItem('mock-crashed') === '1'
      }),
      closeConfirmed: async () => {
        const w = window as unknown as { __mockClosed?: number }
        w.__mockClosed = (w.__mockClosed ?? 0) + 1
      },
      // 浏览器验证：window.__triggerRequestClose() 模拟点标题栏 X
      onRequestClose: (cb: () => void) => {
        const w = window as unknown as {
          __requestCloseCbs: (() => void)[]
          __triggerRequestClose: () => void
        }
        w.__requestCloseCbs ??= []
        w.__requestCloseCbs.push(cb)
        w.__triggerRequestClose ??= () => {
          for (const fn of w.__requestCloseCbs) fn()
        }
        return () => {
          w.__requestCloseCbs = w.__requestCloseCbs.filter((f) => f !== cb)
        }
      }
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

createApp(App).use(createPinia()).use(i18n).mount('#app')
