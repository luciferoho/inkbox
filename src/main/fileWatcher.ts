import { BrowserWindow, ipcMain } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/**
 * 打开文档的外部修改检测：
 * - 按文件粒度注册（监听其所在目录，过滤文件名——直接 watch 单文件在部分编辑器/网盘同步下不可靠）
 * - 变更防抖 300ms 后广播 fs:fileChanged；是否真的提示（自身保存/无实质变化）由渲染层比对内容决定
 */
interface WatchState {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

const watching = new Map<string, WatchState>()

function broadcast(path: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('fs:fileChanged', { path })
  }
}

function schedule(path: string, state: WatchState): void {
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state.timer = null
    if (watching.has(path)) broadcast(path)
  }, 300)
}

export function registerFileWatcherIpc(): void {
  ipcMain.on('fs:watch', (_e, path: string) => {
    if (!path || watching.has(path)) return
    try {
      const watcher = watch(dirname(path), (_event, filename) => {
        // filename 为 null（部分平台）时保守视为命中
        if (filename && basename(path) !== filename) return
        const state = watching.get(path)
        if (state) schedule(path, state)
      })
      watching.set(path, { watcher, timer: null })
    } catch {
      /* 目录不存在等：外部修改检测静默降级 */
    }
  })

  ipcMain.on('fs:unwatch', (_e, path: string) => {
    const state = watching.get(path)
    if (!state) return
    if (state.timer) clearTimeout(state.timer)
    state.watcher.close()
    watching.delete(path)
  })

  /* ---------- 工作区目录递归监听（文件树外部变化刷新） ---------- */

  ipcMain.on('ws:watch', (_e, root: string) => {
    if (!root || wsWatching.has(root)) return
    try {
      const watcher = watch(root, { recursive: true }, () => {
        const state = wsWatching.get(root)
        if (!state) return
        if (state.timer) clearTimeout(state.timer)
        state.timer = setTimeout(() => {
          state.timer = null
          broadcastWs(root)
        }, 400)
      })
      wsWatching.set(root, { watcher, timer: null })
    } catch {
      /* 目录不存在等：文件树刷新静默降级 */
    }
  })

  ipcMain.on('ws:unwatch', (_e, root: string) => {
    const state = wsWatching.get(root)
    if (!state) return
    if (state.timer) clearTimeout(state.timer)
    state.watcher.close()
    wsWatching.delete(root)
  })
}

interface WsWatchState {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

const wsWatching = new Map<string, WsWatchState>()

function broadcastWs(root: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('fs:wsChanged', { root })
  }
}
