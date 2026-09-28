import { registerFsIpc } from './fs'
import { registerDialogIpc } from './dialog'
import { registerConfigIpc } from './config'
import { registerWinIpc } from './win'

export function registerIpcHandlers(): void {
  registerFsIpc()
  registerDialogIpc()
  registerConfigIpc()
  registerWinIpc()
}
