import { ipcMain } from 'electron'
import { readFile, writeFile, readdir, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DirEntry } from '@shared/types'

export function registerFsIpc(): void {
  ipcMain.handle('fs:readFile', async (_e, path: string): Promise<string> => {
    return await readFile(path, 'utf-8')
  })

  ipcMain.handle('fs:writeFile', async (_e, path: string, content: string): Promise<void> => {
    await writeFile(path, content, 'utf-8')
  })

  /** 二进制写入（图片落盘等），base64 载荷；父目录自动创建 */
  ipcMain.handle(
    'fs:writeBinary',
    async (_e, path: string, base64: string): Promise<void> => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.from(base64, 'base64'))
    }
  )

  /** 新建文件（空内容）或目录 */
  ipcMain.handle('fs:create', async (_e, path: string, isDir: boolean): Promise<void> => {
    if (isDir) await mkdir(path, { recursive: true })
    else await writeFile(path, '', 'utf-8')
  })

  ipcMain.handle('fs:rename', async (_e, oldPath: string, newPath: string): Promise<void> => {
    await rename(oldPath, newPath)
  })

  /** 删除文件或目录（目录递归） */
  ipcMain.handle('fs:delete', async (_e, path: string): Promise<void> => {
    await rm(path, { recursive: true, force: true })
  })

  /** 非递归列目录，目录在前、按名排序；用于文件树面板 */
  ipcMain.handle('fs:readDir', async (_e, path: string): Promise<DirEntry[]> => {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .map((d) => ({ name: d.name, path: join(path, d.name), isDir: d.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1))
  })
}
