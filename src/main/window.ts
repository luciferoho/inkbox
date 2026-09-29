import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { DetachDoc, InitialDoc } from '@shared/types'
import { clearSession, isSessionCrashed } from './session'
import { releaseWindowDocs } from './docRegistry'
import { isQuitting } from './tray'
import { getConfig } from './ipc/config'

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
    backgroundColor: '#F6F2EC',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  // 渲染层启动时经 win:takeInitialDoc 取走（拖出标签的文档与窗口键）
  pendingDocs.set(win.webContents.id, {
    windowKey,
    doc: doc ?? null,
    crashed: isSessionCrashed()
  })
  windowKeys.set(win.webContents.id, windowKey)

  // 「最小化到托盘」：点关闭仅隐藏窗口（正在退出时放行），配置即时生效
  win.on('close', (e) => {
    if (isQuitting()) return
    if (getConfig().closeAction === 'tray') {
      e.preventDefault()
      win.hide()
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

  // 自绘标题栏需要同步最大化状态（加载完成后重发一次，避免早于渲染层订阅而丢失）
  const sendState = (): void =>
    win.webContents.send('win:state', { maximized: win.isMaximized() })
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)
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
