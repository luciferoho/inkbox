import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultConfig,
  defaultWindowPrefs,
  type AppConfig,
  type RecentFile,
  type WindowPrefs
} from '@shared/types'
import { rebuildMenus, setLocale } from '../i18n'
import { createMenu } from '../menu'
import { retranslateTray } from '../tray'

/** 简单 JSON 配置存储（userData/config.json），深度合并默认值 */
let cache: AppConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** 兼容旧版 recent: string[] 格式 */
function normalizeRecent(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 10)
    .map((r): RecentFile =>
      typeof r === 'string' ? { path: r, ts: 0 } : { path: String(r?.path ?? ''), ts: Number(r?.ts) || 0 }
    )
    .filter((r) => r.path !== '')
}

function load(): AppConfig {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8')) as Partial<AppConfig> & {
      sidebarWidth?: number
    }
    const rawEditor = (raw.editor ?? {}) as Record<string, unknown>
    cache = {
      ...defaultConfig,
      ...raw,
      editor: {
        fontSize: Number(rawEditor.fontSize) || defaultConfig.editor.fontSize,
        lineHeight: Number(rawEditor.lineHeight) || defaultConfig.editor.lineHeight
      },
      autosave: { ...defaultConfig.autosave, ...raw.autosave },
      recent: normalizeRecent(raw.recent)
    }
    // 旧版把纸宽/侧栏宽存在全局 config：迁入 w1 的窗口偏好（一次性，读不到就跳过）
    const legacySidebar = Number(raw.sidebarWidth)
    const legacyPageWidth = Number(rawEditor.pageWidthPct)
    if (legacySidebar || legacyPageWidth) {
      const prefs = loadWindowPrefs()
      if (!prefs.w1) {
        prefs.w1 = {
          ...defaultWindowPrefs,
          ...(legacySidebar ? { sidebarWidth: legacySidebar } : {}),
          ...(legacyPageWidth ? { pageWidthPct: legacyPageWidth } : {})
        }
        persistWindowPrefs(prefs)
      }
    }
  } catch {
    cache = { ...defaultConfig }
  }
  return cache
}

/** 主进程内读取当前配置（窗口关闭行为等原生逻辑用，与渲染层 IPC 共享缓存） */
export function getConfig(): AppConfig {
  return load()
}

function persist(): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  // 原子写（tmp + rename）：避免退出瞬间截断 config.json
  const final = configPath()
  const tmp = final + '.tmp'
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
  renameSync(tmp, final)
}

/* ---------- 窗口私有偏好（window-prefs.json，按窗口键隔离，不广播） ---------- */

let winCache: Record<string, WindowPrefs> | null = null

function windowPrefsPath(): string {
  return join(app.getPath('userData'), 'window-prefs.json')
}

function loadWindowPrefs(): Record<string, WindowPrefs> {
  if (winCache) return winCache
  try {
    winCache = JSON.parse(readFileSync(windowPrefsPath(), 'utf-8')) as Record<string, WindowPrefs>
  } catch {
    winCache = {}
  }
  return winCache
}

function persistWindowPrefs(prefs: Record<string, WindowPrefs>): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const final = windowPrefsPath()
  const tmp = final + '.tmp'
  writeFileSync(tmp, JSON.stringify(prefs, null, 2), 'utf-8')
  renameSync(tmp, final)
}

/** 窗口键来自渲染层，落盘前收敛字符集（与草稿文件名同一套白名单） */
function safeKey(key: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(key) ? key : 'w1'
}

/** 修改后的全局配置广播给所有窗口：各窗口 applyConfig 即时跟随（纸宽/侧栏宽不在其中，互不影响） */
function broadcastConfig(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app:configChanged', cache)
  }
}

/** 开机自启：写系统登录项。仅打包后生效——dev 下 process.execPath 是 electron.exe，注册会污染系统登录项 */
function applyLoginItem(): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: load().openAtLogin })
  } catch (err) {
    console.error('[config] setLoginItemSettings failed:', err)
  }
}

export function registerConfigIpc(): void {
  load() // 启动即读：旧配置迁移要在首个窗口读取窗口偏好前完成
  applyLoginItem()

  ipcMain.handle('app:getConfig', () => load())

  ipcMain.handle('app:setConfig', (_e, patch: Partial<AppConfig>) => {
    const prev = load()
    cache = {
      ...prev,
      ...patch,
      editor: { ...prev.editor, ...patch.editor },
      autosave: { ...prev.autosave, ...patch.autosave }
    }
    persist()
    if (patch.openAtLogin !== undefined && patch.openAtLogin !== prev.openAtLogin) applyLoginItem()
    broadcastConfig()
    return cache
  })

  ipcMain.handle('app:getWindowPrefs', (_e, key: string): WindowPrefs => {
    const stored = loadWindowPrefs()[safeKey(key)]
    return { ...defaultWindowPrefs, ...stored }
  })

  ipcMain.handle('app:setWindowPrefs', (_e, key: string, patch: Partial<WindowPrefs>): void => {
    const prefs = loadWindowPrefs()
    const k = safeKey(key)
    prefs[k] = { ...defaultWindowPrefs, ...prefs[k], ...patch }
    persistWindowPrefs(prefs)
  })

  /** 切换界面语言：主进程即刻生效并重建菜单/托盘（渲染层词典由 vue-i18n 自己切换） */
  ipcMain.handle('app:setLocale', (_e, pref: AppConfig['locale']) => {
    setLocale(pref)
    rebuildMenus(createMenu)
    retranslateTray()
  })
}
