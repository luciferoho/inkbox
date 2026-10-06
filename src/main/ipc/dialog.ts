import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import { m } from '../i18n'

function mdOpenFilters(): { name: string; extensions: string[] }[] {
  return [
    { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
    { name: 'HTML', extensions: ['html', 'htm'] },
    { name: m('dlgAllFiles'), extensions: ['*'] }
  ]
}

const SAVE_KINDS: Record<string, string> = { md: 'Markdown', html: 'HTML', tex: 'LaTeX' }

function parentWindow(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

export function registerDialogIpc(): void {
  ipcMain.handle('dialog:openFile', async (e): Promise<string | null> => {
    const win = parentWindow(e)
    const opts: OpenDialogOptions = {
      title: m('dlgOpenMd'),
      properties: ['openFile'],
      filters: mdOpenFilters()
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle('dialog:openFolder', async (e): Promise<string | null> => {
    const win = parentWindow(e)
    const opts: OpenDialogOptions = {
      title: m('dlgOpenFolder'),
      properties: ['openDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  /** 块工具栏「插入图片」：选择本地图片（复制进 .assets 由渲染层编排） */
  ipcMain.handle('dialog:openImage', async (e): Promise<string | null> => {
    const win = parentWindow(e)
    const opts: OpenDialogOptions = {
      title: m('dlgOpenImage'),
      properties: ['openFile'],
      filters: [
        { name: m('dlgImages'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        { name: m('dlgAllFiles'), extensions: ['*'] }
      ]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  ipcMain.handle(
    'dialog:saveFile',
    async (e, defaultName?: string, kind: 'md' | 'html' | 'tex' = 'md'): Promise<string | null> => {
      const win = parentWindow(e)
      const exts: Record<string, string[]> = {
        md: ['md', 'markdown', 'mdown', 'txt'],
        html: ['html'],
        tex: ['tex']
      }
      const opts: SaveDialogOptions = {
        title:
          kind === 'html' ? m('dlgExportHtml') : kind === 'tex' ? m('dlgExportLaTeX') : m('dlgSaveMd'),
        defaultPath: defaultName ?? m('dlgUntitledMd'),
        filters: [{ name: SAVE_KINDS[kind] ?? 'Markdown', extensions: exts[kind] ?? exts.md }]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    }
  )
}
