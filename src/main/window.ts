import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { DetachDoc, InitialDoc } from '@shared/types'
import { accelFromEvent, effectiveShortcuts, normalizeForCompare } from '@shared/shortcuts'
import { clearSession, isSessionCrashed } from './session'
import { releaseWindowDocs } from './docRegistry'
import { isQuitting } from './tray'
import { isMenuSuspended } from './menu'
import { getConfig, themeBackgroundColor } from './ipc/config'

/** 窗口键（w1、w2…）：草稿按窗口隔离；重启后从 1 重新计数，旧草稿归首个窗口接管 */
let nextWindowSeq = 1

/** webContentsId → 窗口键（窗口关闭时清会话文件用） */
const windowKeys = new Map<number, string>()

/** 拖出标签新窗口的待交付文档：webContentsId → 初始载荷 */
const pendingDocs = new Map<number, InitialDoc>()

/** 渲染层启动时一次性取走初始文档与窗口键（未交付的普通窗口返回 null 文档） */
export function consumeInitialDoc(wcId: number): InitialDoc {
  const pending = pendingDocs.get(wcId)
  pendingDocs.delete(wcId)
  return pending ?? { windowKey: 'w1', doc: null, crashed: isSessionCrashed() }
}

export function createAppWindow(doc?: DetachDoc): BrowserWindow {
  const windowKey = `w${nextWindowSeq++}`
  const wa = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    // 初始尺寸不超过屏幕工作区（小屏时收缩；最小尺寸保持产品要求）
    width: Math.min(1280, Math.max(968, wa.width - 40)),
    height: Math.min(840, Math.max(620, wa.height - 40)),
    // 最小尺寸 = 初始尺寸：不允许缩到布局舒适区以下
    minWidth: 1280,
    minHeight: 840,
    // 原创设计：自绘一体化标题栏（见 DESIGN.md），Windows 先行
    frame: false,
    show: false,
    backgroundColor: themeBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // 拼写检查引擎（4.2）：主进程常开（Chromium 内置），渲染层按设置开关
      // 编辑器宿主的 spellcheck 属性——关着时引擎空转零开销
      spellcheck: true,
      // 关掉后台节流：窗口被遮挡时 Chromium 会把渲染进程的 rAF/scroll 事件
      // 冻到 1Hz，编辑器的草稿防抖、滚动恢复落位、双栏联动全部依赖这些时序
      backgroundThrottling: false
    }
  })

  // Windows:右键标题栏(拖拽区)弹的系统菜单(还原/移动/大小…)走非客户区路径,
  // 渲染层拦不到。Electron 官方出口:只要有监听者并 preventDefault,即不弹
  // (Electron 源码 OnSystemContextMenu → *prevent_default = true)
  win.on('system-context-menu', (e) => e.preventDefault())

  // 渲染层启动时经 win:takeInitialDoc 取走（拖出标签的文档与窗口键）。
  // crashed 只认首个窗口：它是"整个运行期"的标志（上次强杀/崩溃），
  // 运行中新开的窗口若也带着它，会把别的窗口正在写的草稿误当崩溃遗留恢复
  pendingDocs.set(win.webContents.id, {
    windowKey,
    doc: doc ?? null,
    crashed: windowKey === 'w1' && isSessionCrashed()
  })
  windowKeys.set(win.webContents.id, windowKey)

  // 应用内快捷键统一在 main 拦截：命中即 preventDefault（页面默认行为与系统菜单加速器都不再走），
  // 由主进程转发 menu:command。避免按键在页面/菜单/外部程序之间重复消费。
  // 注意：QQ 闪传这类**系统级全局热键**在输入到达窗口前就被系统取走，应用无法拦截，
  // 只能避开该组合（默认主题快捷键已改为 Ctrl+Alt+Shift+T，可在设置里改键）。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    if (isMenuSuspended()) return // 改键录制中：放行原始按键给渲染层捕获
    const accel = accelFromEvent({
      key: input.key,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift,
      metaKey: input.meta
    })
    if (!accel) return
    const norm = normalizeForCompare(accel)
    const map = effectiveShortcuts(getConfig().shortcuts)
    for (const [id, value] of Object.entries(map)) {
      if (!value || normalizeForCompare(value) !== norm) continue
      event.preventDefault()
      win.webContents.send('menu:command', id)
      return
    }
  })

  // 「最小化到托盘」：点关闭仅隐藏窗口（正在退出时放行），配置即时生效
  win.on('close', (e) => {
    if (isQuitting()) return
    if (getConfig().closeAction === 'tray') {
      e.preventDefault()
      win.hide()
      // 编辑窗口全部收进托盘后应用主体对用户已不可见：连带关闭设置窗，
      // 否则桌面残留设置窗，托盘唤起的也是它而不是编辑窗口
      const editorStillVisible = BrowserWindow.getAllWindows().some(
        (w) => w !== win && !w.isDestroyed() && !isSettingsWindow(w) && w.isVisible()
      )
      if (!editorStillVisible && settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy()
      return
    }
    // 手动关闭：交给渲染层做未保存检查（WPS 式弹窗），
    // 确认后经 win:closeConfirmed 真正关闭（那里负责置位退出标志）
    e.preventDefault()
    win.webContents.send('app:requestClose')
  })

  // 正常关闭窗口：清掉本窗口的会话快照（多窗口只关其一时其标签不再恢复）。
  // 应用整体退出时保留——下次启动恢复上次打开的标签
  const closedWcId = win.webContents.id
  win.on('closed', () => {
    const key = windowKeys.get(closedWcId)
    windowKeys.delete(closedWcId)
    releaseWindowDocs(closedWcId) // 该窗口占用的文件登记随窗口销毁释放
    if (key && !isQuitting()) void clearSession(key)
  })

  win.on('ready-to-show', () => {
    // Electron 会按 origin 持久化页面缩放（Ctrl+滚轮/Ctrl+= 后记忆），启动时重置，
    // 避免放大态下 CSS 视口小于布局最小宽度导致右侧截断
    win.webContents.setZoomFactor(1)
    win.show()
  })

  // 自绘标题栏需要同步最大化/置顶状态（加载完成后重发一次，避免早于渲染层订阅而丢失）
  const sendState = (): void =>
    win.webContents.send('win:state', {
      maximized: win.isMaximized(),
      alwaysOnTop: win.isAlwaysOnTop()
    })
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)
  win.on('always-on-top-changed', sendState)
  win.webContents.on('did-finish-load', sendState)

  // 外部链接一律走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function createMainWindow(): BrowserWindow {
  return createAppWindow()
}

/* ---------- 独立设置窗口：所有窗口共用一个实例，重复打开 = 聚焦已有窗口 ---------- */

let settingsWin: BrowserWindow | null = null

/** 设置窗口：无边框小工具窗，内容是独立渲染入口 settings.html（不含编辑器）。
 *  关闭不走托盘隐藏/未保存检查，直接关；不参与会话/草稿/文件登记。
 *  退出编排（托盘 requestClose 过滤、最后窗口确认关闭时连带销毁）靠此识别。 */
export function isSettingsWindow(win: BrowserWindow): boolean {
  return win === settingsWin
}
export function showSettingsWindow(origin?: BrowserWindow | null): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore()
    settingsWin.show()
    settingsWin.focus()
    return
  }
  // 以发起窗口所在显示器居中（多显示器时设置窗出现在用户手边）
  const base = origin && !origin.isDestroyed() ? origin.getBounds() : screen.getPrimaryDisplay().bounds
  const wa = screen.getDisplayMatching(base).workArea
  const win = new BrowserWindow({
    width: Math.min(800, Math.max(720, wa.width - 40)),
    height: Math.min(660, Math.max(560, wa.height - 40)),
    minWidth: 720,
    minHeight: 560,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    backgroundColor: themeBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  settingsWin = win

  win.on('system-context-menu', (e) => e.preventDefault())

  // 应用级快捷键在设置窗同样生效（app:settings 命中时命令发回本窗、渲染层忽略，
  // 其余命令无监听者即无操作——比放行页面默认行为更符合应用快捷键语义）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    if (isMenuSuspended()) return
    const accel = accelFromEvent({
      key: input.key,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift,
      metaKey: input.meta
    })
    if (!accel) return
    const norm = normalizeForCompare(accel)
    const map = effectiveShortcuts(getConfig().shortcuts)
    for (const [id, value] of Object.entries(map)) {
      if (!value || normalizeForCompare(value) !== norm) continue
      event.preventDefault()
      win.webContents.send('menu:command', id)
      return
    }
  })

  win.on('closed', () => {
    settingsWin = null
  })

  win.on('ready-to-show', () => {
    win.webContents.setZoomFactor(1)
    win.show()
    win.focus()
  })

  // 关于页的外部链接与主窗口一致：一律走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + '/settings.html')
  } else {
    void win.loadFile(join(__dirname, '../renderer/settings.html'))
  }
}
