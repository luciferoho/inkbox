import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { m } from './i18n'

/**
 * 托盘：常驻图标（打开墨匣 / 退出）+ 应用退出生命周期标志。
 * 「最小化到托盘」模式下点窗口关闭仅隐藏窗口，由托盘菜单真正退出。
 */

let tray: Tray | null = null
let quitting = false

/** 应用是否正在整体退出（before-quit 置位）：窗口 close/closed 钩子据此放行 */
export function isQuitting(): boolean {
  return quitting
}

export function markQuitting(): void {
  quitting = true
}

/** macOS 关窗后点 dock 重开：清除退出标志（Windows 先行，留作跨平台兜底） */
export function resetQuitting(): void {
  quitting = false
}

/** 显示并聚焦主窗口（托盘点击 / 二次启动 second-instance 共用） */
export function showMainWindow(): void {
  const win =
    BrowserWindow.getAllWindows().find((w) => w.isVisible()) ??
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function trayImage(): Electron.NativeImage {
  // 开发态用项目 build/；打包后 extraResources 把 icon.png 放进 resources/
  const p = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')
  return nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
}

function trayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: m('trayOpen'), click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: m('trayQuit'),
      click: () => quitFromTray()
    }
  ])
}

export function createTray(): void {
  if (!tray) tray = new Tray(trayImage())
  retranslateTray()
  tray.on('click', () => showMainWindow())
}

/** 语言切换后刷新托盘提示与菜单文案 */
export function retranslateTray(): void {
  if (!tray) return
  tray.setToolTip(m('trayTooltip'))
  tray.setContextMenu(trayMenu())
}

/**
 * 托盘退出：与点标题栏 X 走同一条未保存检查流程（WPS 弹窗）。
 * 不直接 quit——向各窗口发 requestClose，渲染层检查完毕后经
 * win:closeConfirmed 逐个销毁；最后一个窗口销毁时置位退出标志，
 * window-all-closed 自然触发 app.quit()。取消弹窗则中止退出。
 */
function quitFromTray(): void {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  if (wins.length === 0) {
    markQuitting()
    app.quit()
    return
  }
  for (const w of wins) {
    if (w.isMinimized()) w.restore()
    w.show() // 隐藏在托盘里的窗口也要弹出来，否则看不到未保存提示
    w.webContents.send('app:requestClose')
  }
}
