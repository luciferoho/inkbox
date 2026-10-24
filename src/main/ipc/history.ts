import { app, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryEntry } from '@shared/types'

/** 4.1 版本历史/本地快照：
 *  - 每次成功保存后由渲染层回调 snapshot；内容与最近一份相同则去重跳过
 *    （自动保存高频触发不产生冗余快照）
 *  - 存 userData/snapshots/<路径哈希>/<时间戳>.md（不污染用户文档目录，
 *    与 .assets 的 Typora 惯例不同——历史是应用私有数据）
 *  - 每文件保留最近 KEEP 份，超出裁剪最旧 */

const KEEP = 30

function historyDirFor(path: string): string {
  const h = createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'snapshots', h)
}

const SNAP_RE = /^\d{13}\.md$/

export function registerHistoryIpc(): void {
  ipcMain.handle('history:snapshot', (_e, path: string, content: string) => {
    try {
      const dir = historyDirFor(path)
      mkdirSync(dir, { recursive: true })
      const files = readdirSync(dir).filter((f) => SNAP_RE.test(f)).sort()
      const last = files[files.length - 1]
      if (last && readFileSync(join(dir, last), 'utf8') === content) return { ok: true, skipped: true }
      writeFileSync(join(dir, `${Date.now()}.md`), content)
      while (files.length >= KEEP) {
        rmSync(join(dir, files[0] as string))
        files.shift()
      }
      return { ok: true }
    } catch (err) {
      console.error('[history] snapshot failed:', err)
      return { ok: false }
    }
  })

  ipcMain.handle('history:list', (_e, path: string): HistoryEntry[] => {
    const dir = historyDirFor(path)
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter((f) => SNAP_RE.test(f))
        .sort()
        .reverse()
        .map((f) => ({
          ts: Number(f.slice(0, 13)),
          size: statSync(join(dir, f)).size
        }))
    } catch {
      return []
    }
  })

  ipcMain.handle('history:read', (_e, path: string, ts: number): string | null => {
    if (!Number.isFinite(ts)) return null
    const file = `${ts}.md`
    if (!SNAP_RE.test(file)) return null
    try {
      return readFileSync(join(historyDirFor(path), file), 'utf8')
    } catch {
      return null
    }
  })
}
