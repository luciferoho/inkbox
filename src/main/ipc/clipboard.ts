import { clipboard, ClipboardItem, ipcMain } from 'electron'

/**
 * 剪贴板读写（主进程权威实现）。
 *
 * 渲染层的 navigator.clipboard 在 Electron 里受用户激活/权限约束：
 * 右键菜单这类路径没有真实键盘激活，write 会被拒绝（剪贴板保留上一次的旧内容，
 * 粘出来就是无关的东西），read 也可能读到过期值。统一走这里。
 *
 * 注意：Electron 44 起主进程 clipboard 已是异步 W3C 风格 API
 * （readText/writeText 返回 Promise，富内容用 write([ClipboardItem])）。
 */
export function registerClipboardIpc(): void {
  ipcMain.handle('clipboard:read-text', async (): Promise<string> => clipboard.readText())
  ipcMain.handle('clipboard:write-text', async (_e, text: string): Promise<void> => {
    await clipboard.writeText(text)
  })
  ipcMain.handle('clipboard:write-rich', async (_e, text: string, html?: string): Promise<void> => {
    if (html) {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': text,
          'text/html': html
        })
      ])
    } else {
      await clipboard.writeText(text)
    }
  })
}
