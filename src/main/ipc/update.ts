import { ipcMain } from 'electron'
import { getUpdateState, updateCheck, updateDownload, updateInstall } from '../updater'
import { getUpdateRestartVersion } from '../session'

/** 更新流程 IPC：状态单源在主进程,渲染层经事件订阅 + 主动查询 */
export function registerUpdateIpc(): void {
  ipcMain.handle('update:check', () => void updateCheck())
  ipcMain.handle('update:download', () => void updateDownload())
  ipcMain.handle('update:install', () => updateInstall())
  ipcMain.handle('update:state', () => getUpdateState())
  // 本次启动消费到的更新重启版本号（'' = 非更新重启）,用于恢复提示
  ipcMain.handle('update:restartVersion', () => getUpdateRestartVersion())
}
