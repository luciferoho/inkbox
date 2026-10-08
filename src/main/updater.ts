import { app } from 'electron'
import { m } from './i18n'
import type { UpdateCheckResult } from '@shared/types'

/**
 * 自动更新（GitHub Releases）：electron-builder.yml 的 publish 指向实际仓库、
 * 推送 v* 标签的 Release（含 blockmap）后生效；未发布/网络失败时静默跳过。
 * 差量更新依赖随产物一同发布的 .blockmap。
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return
  void (async () => {
    try {
      const { autoUpdater } = await import('electron-updater')
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

/**
 * 关于页「检查更新」：手动触发一次检查，结果交渲染层呈现（不发系统通知）。
 * 开发版直接返回 unavailable；发现新版本时自动下载、退出应用后安装。
 */
export async function checkUpdateManual(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) return { status: 'unavailable', reason: 'dev' }
  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    const r = await autoUpdater.checkForUpdates()
    const latest = r?.updateInfo?.version
    if (!latest) return { status: 'unavailable', reason: 'empty-feed' }
    const current = app.getVersion()
    return latest === current
      ? { status: 'latest', version: current }
      : { status: 'downloading', version: latest }
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message : String(err) }
  }
}
