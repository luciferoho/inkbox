import { app, ipcMain } from 'electron'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DraftPayload } from '@shared/types'

/**
 * 草稿持久化（userData/drafts/<windowKey>-<tabId>.json）：
 * 未落盘文档的崩溃保险。键带窗口前缀，多窗口互不覆写；
 * 重启后窗口键重新从 w1 计数，历史草稿由首个窗口统一接管恢复。
 */

export interface DraftEntry {
  key: string
  draft: DraftPayload
}

function draftsDir(): string {
  return join(app.getPath('userData'), 'drafts')
}

function safeName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '-') + '.json'
}

export function registerDraftsIpc(): void {
  ipcMain.handle('drafts:save', async (_e, key: string, payload: DraftPayload): Promise<void> => {
    await mkdir(draftsDir(), { recursive: true })
    // 原子写（tmp + rename，rename 可直接覆盖目标）：强杀不会截断也不会丢文件
    const final = join(draftsDir(), safeName(key))
    const tmp = final + '.tmp'
    await writeFile(tmp, JSON.stringify(payload), 'utf-8')
    await rename(tmp, final)
  })

  ipcMain.handle('drafts:list', async (): Promise<DraftEntry[]> => {
    let files: string[]
    try {
      files = await readdir(draftsDir())
    } catch {
      return []
    }
    const entries: DraftEntry[] = []
    for (const f of files) {
      // .tmp 残留回收：强杀落在"写完 tmp、未改名"时用 tmp 兜底
      const isTmp = f.endsWith('.json.tmp')
      const finalName = isTmp ? f.replace(/\.json\.tmp$/, '') : f
      if (isTmp && files.includes(finalName + '.json')) continue
      if (!f.endsWith('.json') && !isTmp) continue
      try {
        entries.push({
          key: finalName,
          draft: JSON.parse(await readFile(join(draftsDir(), f), 'utf-8')) as DraftPayload
        })
      } catch {
        /* 单份备份损坏不阻塞其余恢复 */
      }
    }
    return entries.sort((a, b) => a.draft.ts - b.draft.ts)
  })

  ipcMain.handle('drafts:clear', async (_e, key: string): Promise<void> => {
    await rm(join(draftsDir(), safeName(key)), { force: true })
  })

  ipcMain.handle('drafts:clearAll', async (): Promise<void> => {
    await rm(draftsDir(), { recursive: true, force: true })
  })
}
