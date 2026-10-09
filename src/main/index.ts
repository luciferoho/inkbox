import { app, BrowserWindow, protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow } from './window'
import { createMenu, setShortcutOverrides } from './menu'
import { registerIpcHandlers } from './ipc'
import { createTray, markQuitting, resetQuitting, showMainWindow } from './tray'
import { initUpdateController } from './updater'
import { applyLocaleFromConfig } from './i18n'
import { getConfig } from './ipc/config'
import { detectAbnormalExitAndMark, markCleanExit } from './session'

// 单实例：再次点击桌面图标/启动应用时，聚焦现有窗口而不是开新窗口
// INKBOX_TEST_UPDATE=1（更新链路诊断）：改用独立 userData，不与安装版抢单实例锁
if (process.env.INKBOX_TEST_UPDATE === '1') {
  const testDir = join(app.getPath('appData'), 'Inkbox-UpdaterTest')
  mkdirSync(testDir, { recursive: true })
  app.setPath('userData', testDir)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // 禁用沙箱外的特权页面，收敛安全面
  app.enableSandbox()

  // 开发期固定调试端口：CDP 直连真实窗口排查渲染层问题（打包版不开启）
  if (!app.isPackaged) {
    app.commandLine.appendSwitch('remote-debugging-port', '9222')
  }

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
    // 语言偏好要在创建菜单/托盘之前生效
    applyLocaleFromConfig(() => getConfig().locale ?? 'system')
    registerIpcHandlers()

    // 本地图片协议：预览里的相对路径图片映射为 luci-img://<绝对路径>
    protocol.handle('luci-img', (request) => {
      const filePath = decodeURIComponent(request.url.replace(/^luci-img:\/\//, ''))
      return net.fetch(pathToFileURL(filePath).toString())
    })

    const win = createMainWindow()
    // 快捷键覆盖表先于菜单注入（6.7 自定义加速键随启动生效）
    setShortcutOverrides(getConfig().shortcuts)
    createMenu(win)
    createTray()
    // 启动 10s 后检查更新（GitHub Releases 有新版本才提示，未配置/失败静默）
    initUpdateController()

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
