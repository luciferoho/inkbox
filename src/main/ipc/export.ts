import { BrowserWindow, app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
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
/* 分段截帧的单帧高度：必须低于屏幕工作区高度（~1400），否则 offscreen
   paint 帧会被合成器钳制截断（本机实测） */
const PNG_CHUNK = 1300

/* capturePage 在 offscreen 模式下抛 UnknownVizError（Windows），
   改从 paint 事件取整帧：每次 paint 的 image 就是当前完整画面。
   注意：offscreen 窗口 setContentSize 拉高后 paint 不会产出新尺寸的帧
   （实测恒为初始 1200 高）——因此用「两遍渲染」：第一遍量内容高度，
   第二遍直接按目标高度建窗加载，backing store 创建即分配，无 resize 依赖 */
function createOffscreen(width: number, height: number): Electron.BrowserWindow {
  return new BrowserWindow({
    show: false,
    frame: false,
    width,
    height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true
    }
  })
}

/** 等网络图片与 webfont 加载完成再量高度：img 未加载时高度为 0，KaTeX 等
    webfont 未就绪时文本用回退字体度量——两者都会让两遍渲染的 scrollHeight
    不一致，取帧时内容相对量高基准整体下移 → 拼接错位出现空白带（实测）。
    5s 兜底：加载慢不无限等 */
function waitForImagesAndMeasure(win: Electron.BrowserWindow): Promise<number> {
  return win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const imgs = [...document.images]
        let left = imgs.length
        const done = () => {
          document.fonts.ready.then(() => resolve(Math.ceil(document.documentElement.scrollHeight)))
        }
        if (!left) return done()
        const t = setTimeout(done, 5000)
        imgs.forEach((img) => {
          const step = () => {
            if (--left === 0) {
              clearTimeout(t)
              done()
            }
          }
          if (img.complete) step()
          else {
            img.addEventListener('load', step, { once: true })
            img.addEventListener('error', step, { once: true })
          }
        })
      })
    `) as Promise<number>
}

async function renderPng(html: string): Promise<{ data: Buffer; truncated: boolean }> {
  const tmp = join(app.getPath('userData'), 'export-tmp.html')
  await writeFile(tmp, html, 'utf-8')
  try {
    /* 第一遍：量内容真实高度（offscreen 探针只读 DOM，够用） */
    const probe = createOffscreen(PNG_WIDTH, 1200)
    probe.webContents.setFrameRate(60)
    await probe.loadFile(tmp)
    await delay(300)
    const full = await waitForImagesAndMeasure(probe)
    probe.destroy()

    const height = Math.min(Math.max(400, full), PNG_MAX_HEIGHT)
    const truncated = full > PNG_MAX_HEIGHT

    /* 第二遍：正式渲染。关键约束（本机实测）：离屏窗口的 paint 帧与
       capturePage 都被钳制在屏幕工作区高度（~1400，帧缓冲/合成器均按
       可视区域裁剪），整页一帧必然截断。解法 = 固定矮窗口（1300 < 1400）
       分段滚动逐屏取帧，主进程用 @napi-rs/canvas 拼成完整长图 */
    const win = createOffscreen(PNG_WIDTH, PNG_CHUNK)
    /* 回调里的赋值不参与 TS 控制流分析，用对象属性绕开 never 收窄 */
    const frame: { image: Electron.NativeImage | null } = { image: null }
    let paintSeq = 0
    win.webContents.on('paint', (_e, _dirty, image) => {
      paintSeq++
      frame.image = image
    })
    try {
      win.webContents.setFrameRate(60)
      await win.loadFile(tmp)
      await delay(300)
      const full = await waitForImagesAndMeasure(win)
      const limit = Math.min(full, PNG_MAX_HEIGHT)
      const truncated = full > PNG_MAX_HEIGHT
      const theme = /data-theme="dark"/.test(html) ? '#1d1814' : '#f6f2ec'

      /* 滚动条宽度：paint 帧含窗口右侧滚动条，拼接时逐帧裁掉 */
      const scrollbar = Number(
        await win.webContents.executeJavaScript(
          'window.innerWidth - document.documentElement.clientWidth'
        )
      )
      const contentW = PNG_WIDTH - scrollbar
      const canvas = createCanvas(contentW, limit)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = theme
      ctx.fillRect(0, 0, contentW, limit)

      const maxScroll = Math.max(0, limit - PNG_CHUNK)
      for (let offset = 0; offset < limit; offset += PNG_CHUNK) {
        const target = Math.min(offset, maxScroll)
        const before = paintSeq
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${target})`)
        /* 等滚动真正到位：paint 帧可能来自滚动进行中的合成中间态，
           拿去拼接会与量高基准错位（长图出现重复/空白带） */
        await win.webContents.executeJavaScript(
          `new Promise((done) => {
             const check = () => (Math.abs(window.scrollY - ${target}) <= 1 ? done() : requestAnimationFrame(check))
             check()
           })`
        )
        /* 等滚动后的重绘帧落地（帧率 60，最多 1.5s），再多稳一帧 */
        const t0 = Date.now()
        while (paintSeq <= before && Date.now() - t0 < 1500) await delay(40)
        await delay(120)
        if (!frame.image) throw new Error('PNG render produced no frame')
        const img = await loadImage(frame.image.toPNG())
        const segH = Math.min(PNG_CHUNK, limit - target)
        ctx.drawImage(img, 0, 0, contentW, segH, 0, target, contentW, segH)
        if (target >= maxScroll) break
      }

      if (truncated) {
        /* 截断提示不用文字绘制：主进程 canvas 的 font 解析在打包环境会崩
           （'familie' in undefined），截断本身在对话框里已有 toast 提示 */
        ctx.fillStyle = 'rgba(214, 106, 85, 0.35)'
        ctx.fillRect(0, limit - 56, contentW, 56)
      }
      console.log(`[export:png] full=${full} limit=${limit} chunks=${Math.ceil(limit / PNG_CHUNK)}`)
      return { data: canvas.toBuffer('image/png'), truncated }
    } finally {
      win.destroy()
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
