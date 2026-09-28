import { app, ipcMain } from 'electron'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DraftPayload } from '@shared/types'

/** 草稿持久化（userData/drafts/<tabId>.json）：未落盘文档的崩溃保险 */

function draftsDir(): string {
  return join(app.getPath('userData'), 'drafts')
}

export function registerDraftsIpc(): void {
  ipcMain.handle('drafts:save', async (_e, id: number, payload: DraftPayload): Promise<void> => {
    await mkdir(draftsDir(), { recursive: true })
    await writeFile(join(draftsDir(), `${id}.json`), JSON.stringify(payload), 'utf-8')
  })

  ipcMain.handle('drafts:list', async (): Promise<DraftPayload[]> => {
    let files: string[]
    try {
      files = (await readdir(draftsDir())).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    const drafts: DraftPayload[] = []
    for (const f of files) {
      try {
        drafts.push(JSON.parse(await readFile(join(draftsDir(), f), 'utf-8')) as DraftPayload)
      } catch {
        /* 单份草稿损坏不阻塞其余恢复 */
      }
    }
    return drafts.sort((a, b) => a.ts - b.ts)
  })

  ipcMain.handle('drafts:clear', async (_e, id: number): Promise<void> => {
    await rm(join(draftsDir(), `${id}.json`), { force: true })
  })

  ipcMain.handle('drafts:clearAll', async (): Promise<void> => {
    await rm(draftsDir(), { recursive: true, force: true })
  })
}
