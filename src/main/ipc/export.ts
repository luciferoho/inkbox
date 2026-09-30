import { BrowserWindow, app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PdfExportOptions } from '@shared/types'
import { m } from '../i18n'

const MARGIN_INCHES: Record<PdfExportOptions['margin'], number> = {
  normal: 0.75,
  narrow: 0.4,
  none: 0
}

/* Chromium 把页脚画在下边距盒内：边距为 0 时页脚不可见，开启页码时保底 0.45" */
const FOOTER_MIN_BOTTOM = 0.45

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
    let m = MARGIN_INCHES[opts.margin] ?? 0.75
    const footer = opts.pageNumbers
    if (footer) m = Math.max(m, FOOTER_MIN_BOTTOM)
    // Electron 44：margins 直接给英寸值；页眉置空（默认模板会带标题和日期）
    return await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      landscape: opts.landscape,
      printBackground: true,
      margins: { top: m, bottom: m, left: m, right: m },
      displayHeaderFooter: footer,
      headerTemplate: '<div></div>',
      footerTemplate: footer
        ? `<div style="font-size:8px;color:#8a8078;width:100%;text-align:center;\
font-family:'Segoe UI','PingFang SC','Microsoft YaHei UI',sans-serif;">\
<span class="pageNumber"></span> / <span class="totalPages"></span></div>`
        : undefined
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
        title: m('dlgExportPdf'),
        defaultPath: defaultName || m('dlgUntitledPdf'),
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

  /** PNG 长图：离屏窗口按纸面排版渲染，整页高度一次性截取 */
  ipcMain.handle(
    'export:png',
    async (
      e: IpcMainInvokeEvent,
      html: string,
      defaultName?: string
    ): Promise<{ path: string; truncated: boolean } | null> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const saveOpts = {
        title: m('dlgExportPng'),
        defaultPath: defaultName || m('dlgUntitledPng'),
        filters: [{ name: 'PNG', extensions: ['png'] }]
      }
      const r = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (r.canceled || !r.filePath) return null
      const { data, truncated } = await renderPng(html)
      await writeFile(r.filePath, data)
      return { path: r.filePath, truncated }
    }
  )
}

/* ---------- PNG 离屏渲染 ---------- */

/* 40px body 内边距 + 820px 纸面 = 900 */
const PNG_WIDTH = 900
const PNG_MAX_HEIGHT = 16000

/* capturePage 在 offscreen 模式下抛 UnknownVizError（Windows），
   改从 paint 事件取整帧：每次 paint 的 image 就是当前完整画面 */
async function renderPng(html: string): Promise<{ data: Buffer; truncated: boolean }> {
  const tmp = join(app.getPath('userData'), 'export-tmp.html')
  await writeFile(tmp, html, 'utf-8')
  const win = new BrowserWindow({
    show: false,
    frame: false,
    width: PNG_WIDTH,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true
    }
  })
  /* 回调里的赋值不参与 TS 控制流分析，用对象属性绕开 never 收窄 */
  const frame: { image: Electron.NativeImage | null } = { image: null }
  const onPaint = (_e: Electron.Event, _dirty: Electron.Rectangle, image: Electron.NativeImage): void => {
    frame.image = image
  }
  try {
    win.webContents.on('paint', onPaint)
    await win.loadFile(tmp)
    await delay(300)
    const full = await win.webContents.executeJavaScript(
      'Math.ceil(document.documentElement.scrollHeight)'
    )
    const height = Math.min(Math.max(400, full), PNG_MAX_HEIGHT)
    win.setContentSize(PNG_WIDTH, height)
    await delay(500) // 等重排重绘出一帧新图
    if (!frame.image) throw new Error('PNG render produced no frame')
    return { data: frame.image.toPNG(), truncated: full > PNG_MAX_HEIGHT }
  } finally {
    win.webContents.off('paint', onPaint)
    win.destroy()
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
