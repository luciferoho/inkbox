import { BrowserWindow, app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface PdfExportOptions {
  /** 页边距档位（英寸）：标准 0.75 / 窄 0.4 / 无 0 */
  margin: 'normal' | 'narrow' | 'none'
  landscape: boolean
}

const MARGIN_INCHES: Record<PdfExportOptions['margin'], number> = {
  normal: 0.75,
  narrow: 0.4,
  none: 0
}

/**
 * PDF 生成：隐藏窗口加载单文件 HTML 后走 printToPDF 打印管线（墨块/背景保留）。
 * 经临时文件加载（data URL 有 ~2MB 限制，大文档会超）。
 */
async function renderPdf(html: string, opts: PdfExportOptions): Promise<Buffer> {
  const tmp = join(app.getPath('userData'), 'export-tmp.html')
  await writeFile(tmp, html, 'utf-8')
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await pdfWin.loadFile(tmp)
    const m = MARGIN_INCHES[opts.margin] ?? 0.75
    // Electron 44：margins 直接给英寸值
    return await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      landscape: opts.landscape,
      printBackground: true,
      margins: { top: m, bottom: m, left: m, right: m }
    })
  } finally {
    pdfWin.destroy()
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

export function registerExportIpc(): void {
  ipcMain.handle(
    'export:pdf',
    async (
      e: IpcMainInvokeEvent,
      html: string,
      opts: PdfExportOptions,
      defaultName?: string
    ): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const saveOpts = {
        title: '导出 PDF',
        defaultPath: defaultName ?? '未命名.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      }
      const r = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (r.canceled || !r.filePath) return null
      const data = await renderPdf(html, opts)
      await writeFile(r.filePath, data)
      return r.filePath
    }
  )

  /** 预览：返回 PDF base64（渲染层转 Blob 交给内置查看器），不落盘不弹对话框 */
  ipcMain.handle(
    'export:previewPdf',
    async (_e, html: string, opts: PdfExportOptions): Promise<string> => {
      const data = await renderPdf(html, opts)
      return data.toString('base64')
    }
  )
}
