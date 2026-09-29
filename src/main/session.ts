import { app, ipcMain } from 'electron'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionPayload } from '@shared/types'

/**
 * 窗口会话快照（userData/sessions/<窗口键>.json）：
 * 每个窗口各自保存自己打开的文件标签；窗口正常关闭时删除自己的文件
 * （崩溃时保留 → 下次启动由首窗口统一恢复，兼作崩溃兜底）。
 */

export interface SessionEntry {
  key: string
  session: SessionPayload
}

function sessionsDir(): string {
  return join(app.getPath('userData'), 'sessions')
}

function safeName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '-') + '.json'
}

/** 窗口正常关闭：清掉自己的会话文件（标签随窗口关闭，不再恢复） */
export function clearSession(key: string): Promise<void> {
  return rm(join(sessionsDir(), safeName(key)), { force: true })
}

export function registerSessionIpc(): void {
  ipcMain.handle('session:save', async (_e, key: string, payload: SessionPayload): Promise<void> => {
    await mkdir(sessionsDir(), { recursive: true })
    await writeFile(join(sessionsDir(), safeName(key)), JSON.stringify(payload), 'utf-8')
  })

  ipcMain.handle('session:load', async (): Promise<SessionEntry[]> => {
    let files: string[]
    try {
      files = (await readdir(sessionsDir())).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    const entries: SessionEntry[] = []
    for (const f of files) {
      try {
        entries.push({
          key: f.replace(/\.json$/, ''),
          session: JSON.parse(await readFile(join(sessionsDir(), f), 'utf-8')) as SessionPayload
        })
      } catch {
        /* 单个会话文件损坏不阻塞其余恢复 */
      }
    }
    return entries
  })

  /** 首窗口恢复完成后清掉其它残留（陈旧窗口的会话，其标签已并入本窗口） */
  ipcMain.handle('session:clearOthers', async (_e, keepKey: string): Promise<void> => {
    let files: string[]
    try {
      files = await readdir(sessionsDir())
    } catch {
      return
    }
    const keep = safeName(keepKey)
    for (const f of files) {
      if (f !== keep) await rm(join(sessionsDir(), f), { force: true }).catch(() => undefined)
    }
  })
}
