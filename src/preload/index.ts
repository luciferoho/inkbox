import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AppInfo,
  DetachDoc,
  DirEntry,
  DraftPayload,
  InitialDoc,
  MenuCommand,
  PdfExportOptions,
  SearchOptions,
  SearchOutcome,
  SessionPayload,
  UpdateStatePayload,
  WindowPrefs
} from '@shared/types'

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
    readDir: (path: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', path),
    /** 递归列出工作区全部文件路径（文件树按名筛选用） */
    listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', root)
  },
  /** 工作区跨文件搜索（递归文本文件，限流） */
  search: {
    run: (root: string, query: string, opts: SearchOptions): Promise<SearchOutcome> =>
      ipcRenderer.invoke('search:run', root, query, opts)
  },
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
    /** 块工具栏「插入图片」：选择本地图片文件 */
    openImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImage'),
    saveFile: (defaultName?: string, kind: 'md' | 'html' | 'tex' = 'md'): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveFile', defaultName, kind)
  },
  export: {
    pdf: (html: string, opts: PdfExportOptions, defaultName?: string): Promise<string | null> =>
      ipcRenderer.invoke('export:pdf', html, opts, defaultName),
    previewPdf: (html: string, opts: PdfExportOptions): Promise<string> =>
      ipcRenderer.invoke('export:previewPdf', html, opts),
    png: (
      html: string,
      defaultName?: string
    ): Promise<{ path: string; truncated: boolean } | null> =>
      ipcRenderer.invoke('export:png', html, defaultName)
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
  /** 跨窗口文件打开去重：同一文件只允许在一个窗口打开 */
  doc: {
    /** 尝试独占打开：被其他窗口占用时通知对方激活并返回 'elsewhere' */
    tryOpen: (path: string): Promise<'ok' | 'elsewhere'> =>
      ipcRenderer.invoke('doc:tryOpen', path),
    acquire: (path: string): void => ipcRenderer.send('doc:acquire', path),
    release: (path: string): void => ipcRenderer.send('doc:release', path),
    /** 其他窗口请求激活本窗口中该文件的标签 */
    onActivateTab: (cb: (path: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, path: string): void => cb(path)
      ipcRenderer.on('doc:activateTab', listener)
      return () => ipcRenderer.removeListener('doc:activateTab', listener)
    }
  },
  /** 窗口会话快照（启动恢复上次打开的文件标签） */
  session: {
    save: (key: string, payload: SessionPayload): Promise<void> =>
      ipcRenderer.invoke('session:save', key, payload),
    load: (): Promise<{ key: string; session: SessionPayload }[]> =>
      ipcRenderer.invoke('session:load'),
    clearOthers: (keepKey: string): Promise<void> =>
      ipcRenderer.invoke('session:clearOthers', keepKey)
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
    },
    /** 工作区目录递归监听：外部增删改后经 fs:wsChanged 广播，文件树据此刷新 */
    watchWorkspace: (root: string): void => ipcRenderer.send('ws:watch', root),
    unwatchWorkspace: (root: string): void => ipcRenderer.send('ws:unwatch', root),
    onWsChanged: (cb: (payload: { root: string }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: { root: string }): void =>
        cb(payload)
      ipcRenderer.on('fs:wsChanged', listener)
      return () => ipcRenderer.removeListener('fs:wsChanged', listener)
    }
  },
  app: {
    getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('app:getConfig'),
    setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
      ipcRenderer.invoke('app:setConfig', patch),
    /** 切换界面语言：主进程同步重建菜单/托盘文案 */
    setLocale: (locale: AppConfig['locale']): Promise<void> =>
      ipcRenderer.invoke('app:setLocale', locale),
    /** 改键录制期间挂起应用菜单（加速器会抢在渲染层之前消费按键） */
    setShortcutsCapture: (on: boolean): void => ipcRenderer.send('app:shortcutsCapture', on),
    /** 关于页：应用版本与运行环境 */
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo'),
    /** dev-only：活体菜单加速器快照 / 按命令 id 触发菜单项（真窗口注入不了 OS 键击时验证用） */
    debugMenuAccels: (): Promise<Record<string, string | null>> =>
      ipcRenderer.invoke('app:debugMenuAccels'),
    debugMenuInvoke: (id: string): Promise<boolean> => ipcRenderer.invoke('app:debugMenuInvoke', id),
    /** 窗口私有偏好（纸宽/侧栏宽）：按窗口键存取，不跨窗口同步 */
    getWindowPrefs: (key: string): Promise<WindowPrefs> =>
      ipcRenderer.invoke('app:getWindowPrefs', key),
    setWindowPrefs: (key: string, patch: Partial<WindowPrefs>): Promise<void> =>
      ipcRenderer.invoke('app:setWindowPrefs', key, patch),
    /** 任一窗口改了全局配置后，这里收到最新完整配置（纸宽/侧栏宽不在其中） */
    onConfigChanged: (cb: (cfg: AppConfig) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, cfg: AppConfig): void => cb(cfg)
      ipcRenderer.on('app:configChanged', listener)
      return () => ipcRenderer.removeListener('app:configChanged', listener)
    }
  },
  /** 更新流程：状态单源在主进程，渲染层经 onState 订阅全量快照 */
  update: {
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    state: (): Promise<UpdateStatePayload> => ipcRenderer.invoke('update:state'),
    /** 本次启动消费到的更新重启版本号（'' = 非更新重启） */
    restartVersion: (): Promise<string> => ipcRenderer.invoke('update:restartVersion'),
    onState: (cb: (s: UpdateStatePayload) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, s: UpdateStatePayload): void => cb(s)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    }
  },
  image: {
    /** 图床上传（PicGo server 协议）：返回 {ok, url} 或 {ok:false, error, code?}，code='unreachable' 表示服务端连不上（PicGo 未启动等）；失败由调用方回退本地 */
    upload: (
      fileName: string,
      dataUrl: string
    ): Promise<{ ok: boolean; url?: string; error?: string; code?: 'unreachable' }> =>
      ipcRenderer.invoke('image:upload', fileName, dataUrl)
  },
  plugin: {
    /** 扫描插件目录（清单校验在主进程），返回全部发现的插件（含 error 项） */
    list: (): Promise<import('@shared/types').PluginInfo[]> => ipcRenderer.invoke('plugin:list'),
    /** 读取插件入口源码（字符串）。渲染层 pluginHost 在受控 inkbox API 下执行 */
    readCode: (id: string): Promise<string | null> => ipcRenderer.invoke('plugin:readCode', id),
    /** 打开（不存在则创建）插件目录 */
    openDir: (): Promise<void> => ipcRenderer.invoke('plugin:openDir')
  },
  win: {
    minimize: (): void => ipcRenderer.send('win:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('win:toggleMaximize'),
    close: (): void => ipcRenderer.send('win:close'),
    /** 固定窗口（始终置顶） */
    toggleAlwaysOnTop: (): void => ipcRenderer.send('win:toggleAlwaysOnTop'),
    /** 拖出标签到新窗口 */
    openDoc: (doc: DetachDoc): void => ipcRenderer.send('win:openDoc', doc),
    /** 启动时一次性取走初始文档与窗口键 */
    takeInitialDoc: (): Promise<InitialDoc> => ipcRenderer.invoke('win:takeInitialDoc'),
    /** 手动关闭握手：未保存检查完成后确认关闭 */
    closeConfirmed: (): Promise<void> => ipcRenderer.invoke('win:closeConfirmed'),
    /** 主进程请求渲染层执行关闭前检查（点标题栏 X） */
    onRequestClose: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('app:requestClose', listener)
      return () => ipcRenderer.removeListener('app:requestClose', listener)
    }
  },
  /** 订阅主进程菜单/快捷键命令；返回取消订阅函数 */
  onMenuCommand: (cb: (cmd: MenuCommand) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, cmd: MenuCommand): void => cb(cmd)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  /** 订阅窗口状态（最大化/置顶，自绘标题栏需要） */
  onWinState: (cb: (state: { maximized: boolean; alwaysOnTop: boolean }) => void): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      state: { maximized: boolean; alwaysOnTop: boolean }
    ): void => cb(state)
    ipcRenderer.on('win:state', listener)
    return () => ipcRenderer.removeListener('win:state', listener)
  }
}

export type LuciApi = typeof api
contextBridge.exposeInMainWorld('api', api)
