import { app, ipcMain } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

function persist(): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath(), JSON.stringify(cache, null, 2), 'utf-8')
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
