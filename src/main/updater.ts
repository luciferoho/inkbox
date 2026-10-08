import { app } from 'electron'
import { m } from './i18n'
import type { AppUpdater } from 'electron-updater'
import type { UpdateCheckResult } from '@shared/types'

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
  try {
    const autoUpdater = await loadAutoUpdater()
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = console
    // v6 返回 null = 官方判定无更新（含同版本/降级）；否则为最新版本 UpdateInfo
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
