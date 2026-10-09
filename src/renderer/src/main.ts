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
    editor: { fontSize: 16, lineHeight: 1.7 },
    autosave: { enabled: true, intervalMs: 15000 },
    upload: { enabled: false, server: 'http://127.0.0.1:36677/upload' },
    vimMode: false,
    restoreTabs: true,
    restoreFolders: true,
    openAtLogin: false,
    closeAction: 'quit' as const,
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
      readDir: async () => [],
      listFiles: async () => [...files.keys()]
    },
    search: {
      run: async () => ({ files: [], truncated: false, scanned: 0 })
    },
    dialog: {
      openFile: async () => null,
      openFolder: async () => null,
      openImage: async () => null,
      saveFile: async () => null
    },
    export: {
      pdf: async () => null,
      previewPdf: async () => {
        throw new Error('mock: PDF 预览仅在应用内可用')
      },
      png: async () => null
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
      },
      watchWorkspace: () => undefined,
      unwatchWorkspace: () => undefined,
      onWsChanged: () => () => undefined
    },
    app: {
      getConfig: async () => cfg,
      setConfig: async (patch: Partial<AppConfig>) => {
        Object.assign(cfg, patch)
        localStorage.setItem('mock-cfg', JSON.stringify(cfg))
        return cfg as AppConfig
      },
      setLocale: async () => undefined,
      // 浏览器 mock：静态应用信息（版本对齐 package.json），检查更新恒为最新
      getInfo: async () => ({
        version: '1.0.0',
        electron: '-',
        chrome: '-',
        node: '-',
        platform: 'browser',
        packaged: false
      }),
      // 浏览器 mock：没有应用菜单可挂起，改键录制的加速键防护为空操作
      setShortcutsCapture: () => undefined,
      debugMenuAccels: async () => ({}),
      debugMenuInvoke: async () => false,
      // 窗口私有偏好：localStorage 按窗口键背书，浏览器里可跨重载验证
      getWindowPrefs: async (key: string) => {
        const { defaultWindowPrefs } = await import('@shared/types')
        try {
          return { ...defaultWindowPrefs, ...JSON.parse(localStorage.getItem(`mock-winprefs-${key}`) ?? '{}') }
        } catch {
          return defaultWindowPrefs
        }
      },
      setWindowPrefs: async (key: string, patch: Partial<import('@shared/types').WindowPrefs>) => {
        const cur = await window.api.app.getWindowPrefs(key)
        localStorage.setItem(`mock-winprefs-${key}`, JSON.stringify({ ...cur, ...patch }))
      },
      onConfigChanged: () => () => undefined
    },
    image: {
      // 浏览器 mock：没有图床可传，统一回退本地（mock FS）
      upload: async () => ({ ok: false, error: 'mock' })
    },
    plugin: {
      // 浏览器 mock：无插件目录可扫，空列表（宿主不装载任何插件）
      list: async () => [],
      readCode: async () => null,
      openDir: async () => undefined
    },
    update: (() => {
      // 浏览器 mock：模拟完整更新流程（available → downloading → downloaded）
      // notes 用 GitHub 渲染后的 HTML 形态（electron-updater 实际行为）,验证 HTML→markdown 转换
      const notes = [
        '<p>跟随当前版本的体验打磨。</p>',
        '<h2>新增</h2>',
        '<ul>',
        '<li>支持 GitHub 风格居中块渲染</li>',
        '<li>更新弹窗与下载进度指示</li>',
        '<li>修复若干问题</li>',
        '</ul>'
      ].join('\n')
      let state: import('@shared/types').UpdateStatePayload = {
        phase: 'idle',
        version: '',
        notes: '',
        percent: 0,
        bps: 0,
        force: false,
        error: '',
        releaseDate: ''
      }
      const listeners = new Set<(s: import('@shared/types').UpdateStatePayload) => void>()
      const emit = (patch: Partial<import('@shared/types').UpdateStatePayload>): void => {
        state = { ...state, ...patch }
        for (const cb of listeners) cb(state)
      }
      return {
        check: async () => {
          emit({ phase: 'checking', error: '' })
          setTimeout(
            () =>
              emit({
                phase: 'available',
                version: '9.9.9',
                notes,
                force: false,
                percent: 0,
                error: '',
                releaseDate: new Date(Date.now() - 3600_000).toISOString()
              }),
            800
          )
        },
        download: async () => {
          // 先模拟连接空窗（真实场景 download-progress 首个事件前有 1-3s 延迟）
          setTimeout(() => {
            let percent = 0
            const timer = setInterval(() => {
              percent = Math.min(100, percent + Math.round(8 + Math.random() * 14))
              emit({ phase: 'downloading', percent, bps: 1024 * 1024 * 2.4 })
              if (percent >= 100) {
                clearInterval(timer)
                setTimeout(() => emit({ phase: 'downloaded', percent: 100 }), 500)
              }
            }, 350)
          }, 1200)
        },
        install: async () => {
          // mock：重置回 idle（真实流程由主进程交接安装器）
          emit({ phase: 'idle' })
        },
        state: async () => state,
        restartVersion: async () => '',
        onState: (cb: (s: import('@shared/types').UpdateStatePayload) => void) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
        /** 测试钩子：模拟强制更新（弹窗不可关闭、自动开始下载） */
        force: () => {
          emit({
            phase: 'available',
            version: '9.9.9',
            notes: '## 强制更新\n\nforce-update：本版本必须升级。',
            force: true,
            percent: 0,
            error: ''
          })
        }
      }
    })(),
    win: {
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      toggleAlwaysOnTop: () => undefined,
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

/* 全局禁用默认右键菜单：内容区不再弹 Chromium 菜单，标题栏拖拽区不再弹系统
   菜单（还原/移动/大小…）。自绘菜单（标签栏等）自己监听 contextmenu 弹自定义
   面板——这里只 preventDefault、不阻断传播，互不影响。 */
window.addEventListener('contextmenu', (e) => e.preventDefault(), true)

createApp(App).use(createPinia()).use(i18n).mount('#app')
