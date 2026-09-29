import { BrowserWindow, ipcMain, webContents } from 'electron'

/**
 * 跨窗口文件打开注册表：path → 占用窗口的 webContentsId。
 * 保证同一文件同一时刻只在一个窗口打开：其他窗口尝试打开时，
 * 聚焦占用窗口并通知其激活对应标签，请求方收到 'elsewhere' 后不再打开。
 */
const registry = new Map<string, number>()

export function registerDocRegistryIpc(): void {
  ipcMain.handle('doc:tryOpen', (e, path: string): 'ok' | 'elsewhere' => {
    const owner = registry.get(path)
    if (owner !== undefined && owner !== e.sender.id) {
      const wc = webContents.fromId(owner)
      if (wc && !wc.isDestroyed()) {
        wc.send('doc:activateTab', path)
        // 把占用窗口提到前台聚焦，用户直接看到被激活的标签
        const win = BrowserWindow.fromId(owner)
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
        return 'elsewhere'
      }
      registry.delete(path) // 占用窗口已销毁：登记失效
    }
    registry.set(path, e.sender.id)
    return 'ok'
  })

  /** 路径归属变更（另存为/重命名/拖拽接管） */
  ipcMain.on('doc:acquire', (e, path: string) => {
    if (path) registry.set(path, e.sender.id)
  })

  ipcMain.on('doc:release', (e, path: string) => {
    if (path && registry.get(path) === e.sender.id) registry.delete(path)
  })
}

/** 窗口销毁：清掉该窗口占用的全部登记 */
export function releaseWindowDocs(wcId: number): void {
  for (const [path, id] of [...registry]) {
    if (id === wcId) registry.delete(path)
  }
}
