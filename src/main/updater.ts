import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { m } from './i18n'
import type { AppUpdater } from 'electron-updater'
import type { UpdateCheckResult } from '@shared/types'

/** 已下载待装的新版本（update-downloaded 事件驱动；重启应用即安装） */
let downloadedVersion: string | null = null
let downloadedListenerAttached = false

/**
 * 更新器缓存的 pending 目录里探测已就绪的更新：
 * 覆盖「上次运行时已下载、本次重启后事件状态丢失」的场景
 * （electron-updater 不暴露该状态，只能读缓存目录,失败则放弃探测）。
 */
function probePendingUpdate(): string | null {
  try {
    const dir = join(process.env.LOCALAPPDATA ?? '', 'inkbox-updater', 'pending')
    if (!existsSync(dir)) return null
    const info = JSON.parse(readFileSync(join(dir, 'update-info.json'), 'utf-8')) as {
      version?: string
    }
    return info.version && existsSync(join(dir, `Inkbox-${info.version}-setup.exe`))
      ? info.version
      : null
  } catch {
    return null
  }
}

/**
 * 动态加载 electron-updater。CJS 模块经 ESM import() 的互操作下，具名导出
 * 可能不提升到命名空间（autoUpdater undefined），需回退到 default 取。
 */
async function loadAutoUpdater(): Promise<AppUpdater> {
  const mod = (await import('electron-updater')) as {
    autoUpdater?: AppUpdater
    default?: { autoUpdater: AppUpdater }
  }
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
  if (!autoUpdater) throw new Error('electron-updater load failed')
  return autoUpdater
}

/**
 * 自动更新（GitHub Releases）：electron-builder.yml 的 publish 指向实际仓库、
 * 推送 v* 标签的 Release（含 blockmap）后生效；未发布/网络失败时静默跳过。
 * 差量更新依赖随产物一同发布的 .blockmap。
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  void (async () => {
    try {
      const autoUpdater = await loadAutoUpdater()
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      const r = await autoUpdater.checkForUpdatesAndNotify({
        title: m('updateTitle'),
        body: m('updateBody')
      })
      if (r?.updateInfo) console.log('[updater] current:', r.updateInfo.version)
    } catch (err) {
      console.log('[updater] check skipped:', err instanceof Error ? err.message : err)
    }
  })()
}

/** 语义化版本比较：a 大于 b 返回 1（防降级：Release 上版本更旧时不下装） */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

/**
 * 关于页「检查更新」：手动触发一次检查，结果交渲染层呈现（不发系统通知）。
 * 开发版默认返回 unavailable;设 INKBOX_TEST_UPDATE=1 可在开发版里走真实
 * 检查（依赖项目根的 dev-app-update.yml,用于诊断更新链路）。
 */
export async function checkUpdateManual(): Promise<UpdateCheckResult> {
  if (!app.isPackaged && process.env.INKBOX_TEST_UPDATE !== '1') {
    return { status: 'unavailable', reason: 'dev' }
  }
  // 已下载待装 > 一切：此时再查永远 null,必须显式告知「重启即装」
  const pending = downloadedVersion ?? probePendingUpdate()
  if (pending) return { status: 'downloaded', version: pending }
  try {
    const autoUpdater = await loadAutoUpdater()
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = console
    if (!downloadedListenerAttached) {
      downloadedListenerAttached = true
      autoUpdater.on('update-downloaded', (i) => {
        downloadedVersion = (i as { version?: string }).version ?? null
        console.log('[updater] downloaded:', downloadedVersion)
      })
    }
    // v6 返回 null = 官方判定无更新（含同版本/降级/已下载待装）；否则为最新版本 UpdateInfo
    const r: unknown = await autoUpdater.checkForUpdates()
    const remote = (r as { version?: string } | null)?.version ?? ''
    if (!isNewerVersion(remote, app.getVersion())) {
      return { status: 'latest', version: app.getVersion() }
    }
    return { status: 'downloading', version: remote }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[updater] manual check failed:', reason)
    return { status: 'unavailable', reason }
  }
}
