import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONTENT_WIDTH_MAX,
  CONTENT_WIDTH_MIN,
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

/** 简单 JSON 配置存储（userData/config.json），深度合并默认值 */
let cache: AppConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** 兼容旧版 recent: string[] 格式 */
function normalizeRecent(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .slice(0, 10)
    .map((r): RecentFile =>
      typeof r === 'string' ? { path: r, ts: 0 } : { path: String(r?.path ?? ''), ts: Number(r?.ts) || 0 }
    )
    .filter((r) => {
      if (r.path === '') return false
      // Windows 路径同一性：分隔符与大小写不敏感——「打开文件」对话框给反斜杠、
      // 应用内链接/脚本给正斜杠，字面去重会把同一文件记成两条
      const key = r.path.replace(/[\\/]+/g, '\\').toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
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

/** 外观扩展（M3）：字段都只收字符串，非法/缺省回空串（= 内置默认） */
function normalizeAppearance(raw: unknown): NonNullable<AppConfig['appearance']> {
  const def = defaultConfig.appearance!
  if (!raw || typeof raw !== 'object') return { ...def }
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    themeCss: str(r.themeCss),
    themeVariant: str(r.themeVariant) || 'auto',
    bodyFont: str(r.bodyFont),
    codeFont: str(r.codeFont)
  }
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
        lineHeight: Number(rawEditor.lineHeight) || defaultConfig.editor.lineHeight,
        // 内容列统一宽度：非法/越界值钳回可用区间
        contentWidth: Math.min(
          CONTENT_WIDTH_MAX,
          Math.max(
            CONTENT_WIDTH_MIN,
            Math.round(Number(rawEditor.contentWidth) || defaultConfig.editor.contentWidth)
          )
        )
      },
      autosave: { ...defaultConfig.autosave, ...raw.autosave },
      // 旧配置无此键视为开；非布尔垃圾值同样落回默认
      showDocPath: raw.showDocPath !== false,
      shortcuts: normalizeShortcuts(raw.shortcuts),
      upload: normalizeUpload(raw.upload),
      plugins: normalizePlugins(raw.plugins),
      appearance: normalizeAppearance(raw.appearance),
      recent: normalizeRecent(raw.recent)
    }
    // 旧版把侧栏宽存在全局 config：迁入 w1 的窗口偏好（一次性，读不到就跳过；
    // 纸面宽度已下线（固定占满可用宽度），遗留配置不再迁移）
    const legacySidebar = Number(raw.sidebarWidth)
    if (legacySidebar) {
      const prefs = loadWindowPrefs()
      if (!prefs.w1) {
        prefs.w1 = { ...defaultWindowPrefs, sidebarWidth: legacySidebar }
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

/** 窗口底色（创建时/主题切换后）：避免深色主题启动时先闪一帧浅色；
 *  精确的主题底色由渲染层 apply 完成后经 app:themeBackground 回写。 */
export function themeBackgroundColor(): string {
  const pref = cache?.theme ?? 'system'
  const dark = pref === 'dark' || (pref === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#1D1814' : '#F6F2EC'
}

/** 把明暗偏好同步给 nativeTheme：Windows 无边框窗口的 1px 系统边框（DWM）
 *  跟随系统明暗——应用暗色而系统浅色时窗口边缘会出现浅色描边。
 *  themeSource 同时锁定 shouldUseDarkColors，themeBackgroundColor 判定随之一致 */
export function syncNativeTheme(pref: string | undefined): void {
  nativeTheme.themeSource = pref === 'dark' ? 'dark' : pref === 'light' ? 'light' : 'system'
}

export function applyWindowBackground(color: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.setBackgroundColor(color)
  }
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

/** 归一化窗口偏好：只保留已知键，磁盘上已下线字段（旧版 pageWidthPct）不再复活 */
function normalizeWinPrefs(raw: Partial<WindowPrefs> | undefined): WindowPrefs {
  const w = Number(raw?.sidebarWidth)
  return { sidebarWidth: Number.isFinite(w) && w > 0 ? w : defaultWindowPrefs.sidebarWidth }
}

function loadWindowPrefs(): Record<string, WindowPrefs> {
  if (winCache) return winCache
  try {
    const raw = JSON.parse(readFileSync(windowPrefsPath(), 'utf-8')) as Record<string, WindowPrefs>
    winCache = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, normalizeWinPrefs(v)]))
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

  /** 渲染层应用主题后回写真实底色（主题 CSS 可把窗口刷成任意颜色）：
   *  窗口背景与内容一致，切换/resize 时不再闪出默认浅色边 */
  ipcMain.on('app:themeBackground', (_e, color: unknown) => {
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) applyWindowBackground(color)
  })

  ipcMain.handle('app:setConfig', (_e, patch: Partial<AppConfig>) => {
    const prev = load()
    cache = {
      ...prev,
      ...patch,
      editor: { ...prev.editor, ...patch.editor },
      autosave: { ...prev.autosave, ...patch.autosave },
      upload: { ...prev.upload, ...patch.upload },
      plugins: patch.plugins ?? prev.plugins,
      appearance: { ...prev.appearance, ...patch.appearance }
    }
    persist()
    if (patch.openAtLogin !== undefined && patch.openAtLogin !== prev.openAtLogin) applyLoginItem()
    // 明暗偏好变化：同步 nativeTheme（窗口边框/DWM 明暗跟随，见 syncNativeTheme 注释）
    if (patch.theme !== undefined) syncNativeTheme(patch.theme)
    // 快捷键覆盖变化：注入菜单层并重建（渲染层经 broadcastConfig 拿到同一份表）
    if (patch.shortcuts !== undefined) {
      setShortcutOverrides(cache.shortcuts)
      rebuildMenus(createMenu)
    }
    broadcastConfig()
    return cache
  })

  ipcMain.handle('app:getWindowPrefs', (_e, key: string): WindowPrefs => {
    return normalizeWinPrefs(loadWindowPrefs()[safeKey(key)])
  })

  ipcMain.handle('app:setWindowPrefs', (_e, key: string, patch: Partial<WindowPrefs>): void => {
    const prefs = loadWindowPrefs()
    const k = safeKey(key)
    prefs[k] = normalizeWinPrefs({ ...prefs[k], ...patch })
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

  // dev-only 验证钩子：真窗口注入不了 OS 键击，用活体菜单读加速器/触发命令
  if (!app.isPackaged) {
    ipcMain.handle('app:debugMenuAccels', () => debugMenuAccels())
    ipcMain.handle('app:debugMenuInvoke', (_e, id: string) => debugMenuInvoke(id))
  }
}
