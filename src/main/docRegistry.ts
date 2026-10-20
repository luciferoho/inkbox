import { BrowserWindow, ipcMain, webContents } from 'electron'
import { normalize } from 'node:path'

/**
 * 跨窗口文件打开注册表：path → 占用窗口的 webContentsId。
 * 保证同一文件同一时刻只在一个窗口打开：其他窗口尝试打开时，
 * 聚焦占用窗口并通知其激活对应标签，请求方收到 'elsewhere' 后不再打开。
 * 键做归一（分隔符统一 + Windows 大小写不敏感）：不同来源的路径写法
 * （工作区树 / Quick Open / 拖放）混用 / 与 \ 时不会被当成两个文件。
 */
const registry = new Map<string, number>()

function normPath(p: string): string {
  const n = normalize(p)
  return process.platform === 'win32' ? n.toLowerCase() : n
}

export function registerDocRegistryIpc(): void {
  ipcMain.handle('doc:tryOpen', (e, path: string): 'ok' | 'elsewhere' => {
    const key = normPath(path)
    const owner = registry.get(key)
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
      registry.delete(key) // 占用窗口已销毁：登记失效
    }
    registry.set(key, e.sender.id)
    return 'ok'
  })

  /** 路径归属变更（另存为/重命名/拖拽接管） */
  ipcMain.on('doc:acquire', (e, path: string) => {
    if (path) registry.set(normPath(path), e.sender.id)
  })

  ipcMain.on('doc:release', (e, path: string) => {
    if (!path) return
    const key = normPath(path)
    if (registry.get(key) === e.sender.id) registry.delete(key)
  })
}

/** 窗口销毁：清掉该窗口占用的全部登记 */
export function releaseWindowDocs(wcId: number): void {
  for (const [path, id] of [...registry]) {
    if (id === wcId) registry.delete(path)
  }
}
