import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
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

  win.on('ready-to-show', () => {
    // 诊断：窗口实际尺寸 / 屏幕工作区 / 页面缩放（排查初始布局溢出）
    console.log(
      '[inkbox] bounds =',
      JSON.stringify(win.getBounds()),
      'workArea =',
      JSON.stringify(screen.getPrimaryDisplay().workArea),
      'zoom =',
      win.webContents.getZoomFactor()
    )
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
