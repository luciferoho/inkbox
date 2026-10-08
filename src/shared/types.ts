import type { ShortcutOverrides } from './shortcuts'
export type { ShortcutOverrides } from './shortcuts'

/** 应用配置（userData/config.json 持久化，跨窗口同步） */
export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  /** 界面语言：system = 跟随系统；主进程菜单/托盘与渲染层同步切换 */
  locale: 'system' | 'zh-CN' | 'en'
  /** 应用级命令快捷键覆盖（见 shared/shortcuts）：id → 加速键，'' = 禁用，缺省用默认 */
  shortcuts?: ShortcutOverrides
  /** 正文排版（全局）：纸面宽度在各窗口独立，见 WindowPrefs */
  editor: {
    fontSize: number
    lineHeight: number
  }
  autosave: {
    enabled: boolean
    intervalMs: number
  }
  /** 再次打开窗口时恢复上次打开的文件标签 */
  restoreTabs: boolean
  /** 再次打开窗口时恢复上次打开的文件夹 */
  restoreFolders: boolean
  /** 登录系统后自动启动（app.setLoginItemSettings） */
  openAtLogin: boolean
  /** 点窗口关闭按钮的行为：quit = 退出程序；tray = 最小化到托盘（托盘菜单退出） */
  closeAction: 'quit' | 'tray'
  /** Vim 模式：源码/双栏模式启用 vim 键位（@replit/codemirror-vim），即显模式不受影响 */
  vimMode?: boolean
  /** 图床上传（PicGo server 协议）：开启后粘贴/拖拽/插入图片先传图床，失败回退本地 .assets */
  upload: {
    enabled: boolean
    /** PicGo 兼容服务端上传接口（PicGo 应用设置里开启 Server 后的地址） */
    server: string
  }
  /** 插件（userData/plugins 扫描发现）：disabled = 被用户手动关闭的插件 id，缺省启用 */
  plugins?: {
    disabled: string[]
  }
  /** 最近文件，新的在前 */
  recent: RecentFile[]
}

/** 插件清单（userData/plugins/<目录>/plugin.json） */
export interface PluginManifest {
  /** 全局唯一 id（小写字母/数字/连字符），命令注入时用作命名空间 */
  id: string
  /** 显示名 */
  name: string
  version?: string
  description?: string
  /** 入口文件名（目录内相对路径），默认 main.js */
  main?: string
  /** 宿主 API 版本，当前只支持 1 */
  api?: number
}

/** 扫描发现的插件（含清单校验错误；error 存在时不可启用） */
export interface PluginInfo {
  /** 插件目录绝对路径 */
  dir: string
  manifest: PluginManifest
  /** 应用自带（builtin-plugins 随包分发，用户目录同名 id 可覆盖） */
  builtin?: boolean
  error?: string
}

/** 插件注入的命令（渲染层运行态，快捷键面板「插件」组展示） */
export interface PluginCommand {
  /** 全局 id：plugin:<插件id>/<命令id> */
  id: string
  title: string
  /** 来源插件显示名 */
  plugin: string
}

/**
 * 窗口私有偏好（userData/window-prefs.json 按窗口键持久化，不跨窗口同步）：
 * 各窗口尺寸不同，纸面宽度与侧栏宽度独立调整。
 */
export interface WindowPrefs {
  /** 纸面宽度：可用宽度（窗口减去墨脊/侧栏/留白）的百分比，100 = 占满只留四周间距 */
  pageWidthPct: number
  /** 侧栏（大纲/文件面板）宽度 px */
  sidebarWidth: number
}

export const defaultWindowPrefs: WindowPrefs = { pageWidthPct: 80, sidebarWidth: 264 }

export interface RecentFile {
  path: string
  /** 最近打开时间（epoch ms），0 表示未知 */
  ts: number
}

export const defaultConfig: AppConfig = {
  theme: 'system',
  locale: 'system',
  editor: { fontSize: 16, lineHeight: 1.7 },
  autosave: { enabled: true, intervalMs: 15000 },
  restoreTabs: true,
  restoreFolders: true,
  openAtLogin: false,
  closeAction: 'quit',
  shortcuts: {},
  upload: { enabled: false, server: 'http://127.0.0.1:36677/upload' },
  vimMode: false,
  plugins: { disabled: [] },
  recent: []
}

/** 窗口会话快照（userData/sessions/<窗口键>.json）：打开的文件标签与激活项 */
export interface SessionPayload {
  /** 打开的文件标签路径（按标签栏顺序，不含主页/未落盘文档） */
  tabs: string[]
  /** 激活标签的路径；null = 主页或未落盘文档在前 */
  active: string | null
  /** 本窗口打开的工作区文件夹；null = 未打开 */
  folder: string | null
}

/** 主进程菜单/快捷键转发到渲染进程的命令 */
export type MenuCommand =
  | 'file:new'
  | 'file:open'
  | 'file:openFolder'
  | 'file:save'
  | 'file:saveAs'
  | 'file:export'
  | 'file:closeTab'
  | 'file:nextTab'
  | 'file:prevTab'
  | 'view:toggleSidebar'
  | 'view:toggleTheme'
  | 'view:toggleFocus'
  | 'view:toggleTypewriter'
  | 'view:toggleZen'
  | 'view:toggleSearch'
  | 'view:toggleShortcuts'
  | 'edit:find'
  | 'app:settings'
  | 'help:sample'

/** 拖出标签到新窗口时转移的文档载荷 */
export interface DetachDoc {
  /** 原文件路径；null = 未落盘文档 */
  path: string | null
  name: string
  content: string
  dirty: boolean
}

/** 新窗口启动时一次性取走的初始载荷（win:takeInitialDoc） */
export interface InitialDoc {
  /** 窗口键（w1、w2…）：草稿文件按窗口隔离 */
  windowKey: string
  /** 拖出标签带来的文档；普通启动为 null */
  doc: DetachDoc | null
  /** 上次会话异常退出（崩溃/强杀）：本次启动静默恢复草稿与全部标签 */
  crashed: boolean
}

/** 草稿（userData/drafts/<tabId>.json）：未落盘文档的崩溃保险 */
export interface DraftPayload {
  /** 原文件路径；null = 从未保存过的未命名文档 */
  path: string | null
  name: string
  content: string
  /** 草稿写入时间（epoch ms） */
  ts: number
}


/** PDF 导出选项（export:pdf / export:previewPdf 共用） */
export interface PdfExportOptions {
  /** 页边距档位（英寸）：标准 0.75 / 窄 0.4 / 无 0 */
  margin: 'normal' | 'narrow' | 'none'
  landscape: boolean
  /** 页脚页码（n / 总页数）；开启时底部自动留出页脚空间 */
  pageNumbers: boolean
}

/** 全局搜索（工作区跨文件） */
export interface SearchOptions {
  caseSensitive: boolean
}
export interface SearchMatch {
  /** 1 基行号 */
  line: number
  /** 命中行文本（截断） */
  text: string
}
export interface SearchFileResult {
  path: string
  name: string
  matches: SearchMatch[]
}
export interface SearchOutcome {
  files: SearchFileResult[]
  truncated: boolean
  scanned: number
}

/** 文件树条目（fs:readDir 返回） */
export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

/** 应用运行信息（关于页展示 + 反馈 Issue 时附带的诊断信息） */
export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  packaged: boolean
}

/** 手动检查更新结果（关于页「检查更新」按钮） */
export type UpdateCheckResult =
  | { status: 'latest'; version: string }
  | { status: 'downloading'; version: string }
  | { status: 'downloaded'; version: string }
  | { status: 'unavailable'; reason: string }
