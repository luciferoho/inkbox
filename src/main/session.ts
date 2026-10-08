import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionPayload } from '@shared/types'

/**
 * 窗口会话快照（userData/sessions/<窗口键>.json）：
 * 每个窗口各自保存自己打开的文件标签；窗口正常关闭时删除自己的文件
 * （应用整体退出时保留 → 下次启动恢复）。
 * 另有运行锁（userData/running.lock）：启动创建、干净退出删除；
 * 启动时发现它还在 = 上次异常退出（崩溃/强杀），本次按崩溃恢复处理。
 */

export interface SessionEntry {
  key: string
  session: SessionPayload
}

let sessionCrashed = false

function sessionsDir(): string {
  return join(app.getPath('userData'), 'sessions')
}

function runningLockPath(): string {
  return join(app.getPath('userData'), 'running.lock')
}

function safeName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '-') + '.json'
}

/** 启动时调用：检测上次是否异常退出，并留下本次运行锁 */
export function detectAbnormalExitAndMark(): boolean {
  const crashed = existsSync(runningLockPath())
  sessionCrashed = crashed
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(runningLockPath(), String(Date.now()), 'utf-8')
  } catch {
    /* 锁写失败只是失去崩溃检测能力，不影响功能 */
  }
  return crashed
}

/** 干净退出（before-quit）：删运行锁，下次启动走常规恢复路径 */
export function markCleanExit(): void {
  sessionCrashed = false
  try {
    rmSync(runningLockPath(), { force: true })
  } catch {
    /* ignore */
  }
}

export function isSessionCrashed(): boolean {
  return sessionCrashed
}

/** 窗口正常关闭：清掉自己的会话文件（标签随窗口关闭，不再恢复） */
export function clearSession(key: string): Promise<void> {
  return rm(join(sessionsDir(), safeName(key)), { force: true })
}

/** 每个窗口键一条保存串行链：并发保存共用同一个 tmp 文件名，
 *  不排队时第一次 rename 取走文件、第二次 rename 必 ENOENT（会话偶发丢失的另一根源） */
const saveQueues = new Map<string, Promise<void>>()

function enqueueSave(key: string, task: () => Promise<void>): Promise<void> {
  const prev = saveQueues.get(key) ?? Promise.resolve()
  const next = prev.then(task, task) // 前序失败不阻塞本次保存
  saveQueues.set(
    key,
    next.catch(() => undefined)
  )
  return next
}

export function registerSessionIpc(): void {
  // 原子写（tmp + rename）：退出瞬间的写入不会截断成损坏 JSON。
  // 注意不要在 rename 前先删正式文件——rename 在 Windows 上可直接覆盖目标，
  // 先删会留下"正式已删、改名未执行"的强杀空窗，导致会话 JSON 彻底丢失
  ipcMain.handle('session:save', (_e, key: string, payload: SessionPayload): Promise<void> =>
    enqueueSave(key, async () => {
      await mkdir(sessionsDir(), { recursive: true })
      const final = join(sessionsDir(), safeName(key))
      const tmp = final + '.tmp'
      await writeFile(tmp, JSON.stringify(payload), 'utf-8')
      await rename(tmp, final)
    })
  )

  ipcMain.handle('session:load', async (): Promise<SessionEntry[]> => {
    let files: string[]
    try {
      files = await readdir(sessionsDir())
    } catch {
      return []
    }
    const entries: SessionEntry[] = []
    for (const f of files) {
      // .tmp 残留回收：强杀落在"写完 tmp、未改名"时，正式文件可能缺失——用 tmp 兜底
      const isTmp = f.endsWith('.json.tmp')
      const finalName = isTmp ? f.replace(/\.json\.tmp$/, '') : f
      if (isTmp && files.includes(finalName)) continue // 正式文件在：忽略残留
      if (!f.endsWith('.json') && !isTmp) continue
      try {
        entries.push({
          key: finalName,
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
