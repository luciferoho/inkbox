import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, DetachDoc, DirEntry, DraftPayload, InitialDoc, MenuCommand } from '@shared/types'

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
    readBinary: (path: string): Promise<string> => ipcRenderer.invoke('fs:readBinary', path),
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
    saveFile: (defaultName?: string, kind: 'md' | 'html' = 'md'): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveFile', defaultName, kind)
  },
  export: {
    pdf: (
      html: string,
      opts: { margin: 'normal' | 'narrow' | 'none'; landscape: boolean },
      defaultName?: string
    ): Promise<string | null> => ipcRenderer.invoke('export:pdf', html, opts, defaultName),
    previewPdf: (html: string, opts: { margin: 'normal' | 'narrow' | 'none'; landscape: boolean }): Promise<string> =>
      ipcRenderer.invoke('export:previewPdf', html, opts)
  },
  drafts: {
    save: (key: string, payload: DraftPayload): Promise<void> =>
      ipcRenderer.invoke('drafts:save', key, payload),
    list: (): Promise<{ key: string; draft: DraftPayload }[]> => ipcRenderer.invoke('drafts:list'),
    clear: (key: string): Promise<void> => ipcRenderer.invoke('drafts:clear', key),
    clearAll: (): Promise<void> => ipcRenderer.invoke('drafts:clearAll')
  },
  /** 跨窗口标签拖拽：主进程登记中转（dataTransfer 跨窗口不可靠） */
  drag: {
    begin: (doc: DetachDoc): void => ipcRenderer.send('drag:begin', doc),
    end: (): void => ipcRenderer.send('drag:end'),
    take: (): Promise<DetachDoc | null> => ipcRenderer.invoke('drag:take'),
    onConsumed: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('drag:consumed', listener)
      return () => ipcRenderer.removeListener('drag:consumed', listener)
    }
  },
  /** 打开文档的外部修改监听（fire-and-forget 注册，变更经 fs:fileChanged 广播） */
  watch: {
    watch: (path: string): void => ipcRenderer.send('fs:watch', path),
    unwatch: (path: string): void => ipcRenderer.send('fs:unwatch', path),
    onFileChanged: (cb: (payload: { path: string }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: { path: string }): void =>
        cb(payload)
      ipcRenderer.on('fs:fileChanged', listener)
      return () => ipcRenderer.removeListener('fs:fileChanged', listener)
    }
  },
  app: {
    getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('app:getConfig'),
    setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
      ipcRenderer.invoke('app:setConfig', patch)
  },
  win: {
    minimize: (): void => ipcRenderer.send('win:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('win:toggleMaximize'),
    close: (): void => ipcRenderer.send('win:close'),
    /** 拖出标签到新窗口 */
    openDoc: (doc: DetachDoc): void => ipcRenderer.send('win:openDoc', doc),
    /** 启动时一次性取走初始文档与窗口键 */
    takeInitialDoc: (): Promise<InitialDoc> => ipcRenderer.invoke('win:takeInitialDoc')
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
