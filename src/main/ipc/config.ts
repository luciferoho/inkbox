import { app, ipcMain } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultConfig, type AppConfig, type RecentFile } from '@shared/types'

/** 简单 JSON 配置存储（userData/config.json），深度合并默认值 */
let cache: AppConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** 兼容旧版 recent: string[] 格式 */
function normalizeRecent(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 10)
    .map((r): RecentFile =>
      typeof r === 'string' ? { path: r, ts: 0 } : { path: String(r?.path ?? ''), ts: Number(r?.ts) || 0 }
    )
    .filter((r) => r.path !== '')
}

function load(): AppConfig {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8')) as Partial<AppConfig>
    cache = {
      ...defaultConfig,
      ...raw,
      editor: { ...defaultConfig.editor, ...raw.editor },
      autosave: { ...defaultConfig.autosave, ...raw.autosave },
      sidebarWidth: raw.sidebarWidth ?? 264,
      recent: normalizeRecent(raw.recent)
    }
  } catch {
    cache = { ...defaultConfig }
  }
  return cache
}

/** 主进程内读取当前配置（窗口关闭行为等原生逻辑用，与渲染层 IPC 共享缓存） */
export function getConfig(): AppConfig {
  return load()
}

function persist(): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  // 原子写（tmp + rename）：避免退出瞬间截断 config.json
  const final = configPath()
  const tmp = final + '.tmp'
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8')
  renameSync(tmp, final)
}

export function registerConfigIpc(): void {
  ipcMain.handle('app:getConfig', () => load())

  ipcMain.handle('app:setConfig', (_e, patch: Partial<AppConfig>) => {
    const prev = load()
    cache = {
      ...prev,
      ...patch,
      editor: { ...prev.editor, ...patch.editor },
      autosave: { ...prev.autosave, ...patch.autosave }
    }
    persist()
    return cache
  })
}
