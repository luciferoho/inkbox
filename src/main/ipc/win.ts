import { ipcMain, BrowserWindow, type IpcMainEvent } from 'electron'

function fromEvent(e: IpcMainEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

export function registerWinIpc(): void {
  ipcMain.on('win:minimize', (e) => fromEvent(e)?.minimize())

  ipcMain.on('win:toggleMaximize', (e) => {
    const w = fromEvent(e)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })

  ipcMain.on('win:close', (e) => fromEvent(e)?.close())
}
