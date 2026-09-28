import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions } from 'electron'

const MD_OPEN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
  { name: '所有文件', extensions: ['*'] }
]

function parentWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

export function registerDialogIpc(): void {
  ipcMain.handle('dialog:openFile', async (e): Promise<string | null> => {
    const win = parentWindow(e)
    const opts: OpenDialogOptions = {
      title: '打开 Markdown 文件',
      properties: ['openFile'],
      filters: MD_OPEN_FILTERS
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:openFolder', async (e): Promise<string | null> => {
    const win = parentWindow(e)
    const opts: OpenDialogOptions = {
      title: '打开文件夹作为工作区',
      properties: ['openDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (e, defaultName = '未命名.md'): Promise<string | null> => {
    const win = parentWindow(e)
    const opts: SaveDialogOptions = {
      title: '保存 Markdown 文件',
      defaultPath: defaultName,
      filters: MD_OPEN_FILTERS.slice(0, 1)
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return r.canceled || !r.filePath ? null : r.filePath
  })
}
