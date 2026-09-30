import { app } from 'electron'
import { m } from './i18n'

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
