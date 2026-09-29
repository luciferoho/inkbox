import { app, BrowserWindow, protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow } from './window'
import { createMenu } from './menu'
import { registerIpcHandlers } from './ipc'
import { createTray, markQuitting, resetQuitting, showMainWindow } from './tray'
import { initAutoUpdate } from './updater'
import { detectAbnormalExitAndMark, markCleanExit } from './session'

// 单实例：再次点击桌面图标/启动应用时，聚焦现有窗口而不是开新窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // 禁用沙箱外的特权页面，收敛安全面
  app.enableSandbox()

  /** 应用由 Luci 更名 Inkbox：迁移旧 userData 里的配置，避免主题/最近文件丢失 */
  function migrateLegacyConfig(): void {
    const cfg = join(app.getPath('userData'), 'config.json')
    if (existsSync(cfg)) return
    for (const legacyName of ['Luci', 'luci']) {
      const legacy = join(app.getPath('appData'), legacyName, 'config.json')
      if (existsSync(legacy)) {
        mkdirSync(app.getPath('userData'), { recursive: true })
        try {
          copyFileSync(legacy, cfg)
        } catch {
          /* 迁移失败不阻塞启动，用户只是丢了偏好设置 */
        }
        return
      }
    }
  }

  app.whenReady().then(() => {
    migrateLegacyConfig()
    // 先检测上次是否异常退出（崩溃/强杀），再留下本次运行锁
    detectAbnormalExitAndMark()
    registerIpcHandlers()

    // 本地图片协议：预览里的相对路径图片映射为 luci-img://<绝对路径>
    protocol.handle('luci-img', (request) => {
      const filePath = decodeURIComponent(request.url.replace(/^luci-img:\/\//, ''))
      return net.fetch(pathToFileURL(filePath).toString())
    })

    const win = createMainWindow()
    createMenu(win)
    createTray()
    // 启动 10s 后检查更新（GitHub Releases 有新版本才提示，未配置/失败静默）
    setTimeout(() => initAutoUpdate(), 10_000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        resetQuitting()
        const w = createMainWindow()
        createMenu(w)
      }
    })
  })

  app.on('before-quit', () => {
    // 置位后窗口 close/closed 钩子放行：托盘隐藏模式可真正退出，会话文件保留
    markQuitting()
    markCleanExit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
