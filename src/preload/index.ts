import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, DirEntry, MenuCommand } from '@shared/types'

/**
 * 渲染进程唯一入口 API。全部走 invoke/on 白名单频道，
 * 不暴露 ipcRenderer 本体、不暴露任意频道字符串拼接调用。
 */
const api = {
  fs: {
    readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeFile', path, content),
    writeFileBinary: (path: string, base64: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeBinary', path, base64),
    create: (path: string, isDir: boolean): Promise<void> =>
      ipcRenderer.invoke('fs:create', path, isDir),
    rename: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    delete: (path: string): Promise<void> => ipcRenderer.invoke('fs:delete', path),
    readDir: (path: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', path)
  },
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
    saveFile: (defaultName?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveFile', defaultName)
  },
  app: {
    getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('app:getConfig'),
    setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
      ipcRenderer.invoke('app:setConfig', patch)
  },
  win: {
    minimize: (): void => ipcRenderer.send('win:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('win:toggleMaximize'),
    close: (): void => ipcRenderer.send('win:close')
  },
  /** 订阅主进程菜单/快捷键命令；返回取消订阅函数 */
  onMenuCommand: (cb: (cmd: MenuCommand) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, cmd: MenuCommand): void => cb(cmd)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  /** 订阅窗口最大化状态（自绘标题栏需要） */
  onWinState: (cb: (state: { maximized: boolean }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: { maximized: boolean }): void =>
      cb(state)
    ipcRenderer.on('win:state', listener)
    return () => ipcRenderer.removeListener('win:state', listener)
  }
}

export type LuciApi = typeof api
contextBridge.exposeInMainWorld('api', api)
