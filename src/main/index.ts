import { app, BrowserWindow, protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow } from './window'
import { createMenu } from './menu'
import { registerIpcHandlers } from './ipc'

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
  registerIpcHandlers()

  // 本地图片协议：预览里的相对路径图片映射为 luci-img://<绝对路径>
  protocol.handle('luci-img', (request) => {
    const filePath = decodeURIComponent(request.url.replace(/^luci-img:\/\//, ''))
    return net.fetch(pathToFileURL(filePath).toString())
  })

  const win = createMainWindow()
  createMenu(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createMainWindow()
      createMenu(w)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
