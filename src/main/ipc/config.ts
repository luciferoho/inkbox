import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultConfig,
  defaultWindowPrefs,
  type AppConfig,
  type AppInfo,
  type RecentFile,
  type ShortcutOverrides,
  type WindowPrefs
} from '@shared/types'
import { rebuildMenus, setLocale } from '../i18n'
import {
  createMenu,
  debugMenuAccels,
  debugMenuInvoke,
  setMenuSuspended,
  setShortcutOverrides
} from '../menu'
import { retranslateTray } from '../tray'
import { checkUpdateManual } from '../updater'

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

/** 快捷键覆盖表：只收字符串键值（命令 id → 加速键，'' = 禁用） */
function normalizeShortcuts(raw: unknown): ShortcutOverrides {
  const out: ShortcutOverrides = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/** 图床配置：server 只收 http(s) 地址，非法/缺省回默认 */
function normalizeUpload(raw: unknown): AppConfig['upload'] {
  const def = defaultConfig.upload
  if (!raw || typeof raw !== 'object') return { ...def }
  const r = raw as Record<string, unknown>
  const server = typeof r.server === 'string' && /^https?:\/\//i.test(r.server.trim()) ? r.server.trim() : def.server
  return { enabled: r.enabled === true, server }
}

/** 插件配置：只收字符串 id 列表（被禁用的插件），去重 */
function normalizePlugins(raw: unknown): AppConfig['plugins'] {
  const list = (raw as { disabled?: unknown } | null | undefined)?.disabled
  const disabled = Array.isArray(list)
    ? [...new Set(list.filter((x): x is string => typeof x === 'string'))]
    : []
  return { disabled }
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
      shortcuts: normalizeShortcuts(raw.shortcuts),
      upload: normalizeUpload(raw.upload),
      plugins: normalizePlugins(raw.plugins),
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
      autosave: { ...prev.autosave, ...patch.autosave },
      upload: { ...prev.upload, ...patch.upload },
      plugins: patch.plugins ?? prev.plugins
    }
    persist()
    if (patch.openAtLogin !== undefined && patch.openAtLogin !== prev.openAtLogin) applyLoginItem()
    // 快捷键覆盖变化：注入菜单层并重建（渲染层经 broadcastConfig 拿到同一份表）
    if (patch.shortcuts !== undefined) {
      setShortcutOverrides(cache.shortcuts)
      rebuildMenus(createMenu)
    }
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

  /** 改键录制期间挂起应用菜单：加速器会抢在渲染层之前消费按键，录制须先摘掉 */
  ipcMain.on('app:shortcutsCapture', (_e, on: boolean) => setMenuSuspended(!!on))

  /** 关于页：应用版本与运行环境（反馈 Issue 时一并附带的诊断信息） */
  ipcMain.handle('app:getInfo', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
    packaged: app.isPackaged
  }))

  /** 关于页：手动检查更新（打包版有效；发现新版自动下载、退出后安装） */
  ipcMain.handle('app:checkUpdate', () => checkUpdateManual())

  // dev-only 验证钩子：真窗口注入不了 OS 键击，用活体菜单读加速器/触发命令
  if (!app.isPackaged) {
    ipcMain.handle('app:debugMenuAccels', () => debugMenuAccels())
    ipcMain.handle('app:debugMenuInvoke', (_e, id: string) => debugMenuInvoke(id))
  }
}
