import { ipcMain, BrowserWindow, screen, webContents, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { consumeInitialDoc, createAppWindow } from '../window'
import type { DetachDoc } from '@shared/types'

function fromEvent(e: IpcMainEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

/**
 * 跨窗口标签拖拽登记（全局单槽：同一时刻只有一个系统级拖拽）。
 * 源窗口 dragstart 时登记载荷；目标窗口 drop 时 take 取走并广播
 * drag:consumed（源窗口据此移除标签）；drag:end 清理未消费的登记。
 */
interface PendingTabDrag {
  doc: DetachDoc
  originWcId: number
}

let pendingDrag: PendingTabDrag | null = null

/* ---------- 拖拽悬停置顶 ----------
   拖拽期间轮询光标：悬停在哪个墨匣窗口上就把哪个提到顶层（moveTop
   不抢键盘焦点、不打断系统拖拽循环）。否则目标窗口被源窗口挡住时，
   用户看不到它的标签栏，无法瞄准放置。粘性判定：光标未离开刚置顶的
   窗口前不反复切换，避免相邻窗口在重叠区来回闪烁。 */
let dragRaiseTimer: NodeJS.Timeout | null = null
let lastRaised: BrowserWindow | null = null

function cursorInBounds(win: BrowserWindow, x: number, y: number): boolean {
  const b = win.getBounds()
  return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
}

function startDragRaise(): void {
  stopDragRaise()
  if (BrowserWindow.getAllWindows().length < 2) return
  dragRaiseTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint()
    if (lastRaised) {
      if (!lastRaised.isDestroyed() && !lastRaised.isMinimized() && cursorInBounds(lastRaised, p.x, p.y))
        return // 仍在刚置顶的窗口上，保持现状
      lastRaised = null
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isMinimized() || win.isDestroyed()) continue
      if (cursorInBounds(win, p.x, p.y)) {
        win.moveTop()
        lastRaised = win
        break
      }
    }
  }, 120)
}

function stopDragRaise(): void {
  if (dragRaiseTimer) clearInterval(dragRaiseTimer)
  dragRaiseTimer = null
  lastRaised = null
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

  /** 拖出标签 / 右键「移到新窗口」：带着文档载荷开新窗口 */
  ipcMain.on('win:openDoc', (_e, doc: DetachDoc) => {
    createAppWindow(doc)
  })

  /** 新窗口渲染层启动时一次性取走初始文档与窗口键 */
  ipcMain.handle('win:takeInitialDoc', (e: IpcMainInvokeEvent) => consumeInitialDoc(e.sender.id))

  /* ---------- 跨窗口拖拽标签 ---------- */

  ipcMain.on('drag:begin', (e, doc: DetachDoc) => {
    pendingDrag = { doc, originWcId: e.sender.id }
    startDragRaise()
  })

  ipcMain.on('drag:end', () => {
    // 只停悬停置顶轮询，不清登记：drop 与源窗口 dragend 的到达顺序不定，
    // 提前清会让目标窗口的 take 扑空（标签丢失）。登记只由 take 消费，
    // 或被下一次 drag:begin 覆盖——单槽的陈旧条目永远读不到。
    stopDragRaise()
  })

  ipcMain.handle('drag:take', (e: IpcMainInvokeEvent): DetachDoc | null => {
    if (!pendingDrag) return null
    const { doc, originWcId } = pendingDrag
    pendingDrag = null
    stopDragRaise()
    // 通知源窗口：标签已被目标窗口接住（源窗口移除原标签）
    const origin = webContents.fromId(originWcId)
    if (origin && !origin.isDestroyed()) origin.send('drag:consumed')
    return doc
  })
}
