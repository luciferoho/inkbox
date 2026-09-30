import { registerFsIpc } from './fs'
import { registerDialogIpc } from './dialog'
import { registerConfigIpc } from './config'
import { registerWinIpc } from './win'
import { registerExportIpc } from './export'
import { registerDraftsIpc } from './drafts'
import { registerSearchIpc } from './search'
import { registerSessionIpc } from '../session'
import { registerDocRegistryIpc } from '../docRegistry'
import { registerFileWatcherIpc } from '../fileWatcher'

export function registerIpcHandlers(): void {
  registerFsIpc()
  registerDialogIpc()
  registerConfigIpc()
  registerWinIpc()
  registerExportIpc()
  registerDraftsIpc()
  registerSearchIpc()
  registerSessionIpc()
  registerDocRegistryIpc()
  registerFileWatcherIpc()
}
