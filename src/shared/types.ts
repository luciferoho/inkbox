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
    /** 内容列统一宽度（全局，所有窗口/主题一致），px。主题 #write 的 max-width 被覆盖 */
    contentWidth: number
    /** 智能标点（typographer）：直引号→弯引号、--→破折号、...→省略号；仅预览/导出管线，默认关 */
    typographer?: boolean
    /** 拼写检查：编辑器内英文拼写红线（Chromium 内置词典），默认关 */
    spellcheck?: boolean
  }
  autosave: {
    enabled: boolean
    intervalMs: number
    /** 静默保存：自动保存成功不弹「已保存」toast（手动保存不受影响）；默认开 */
    silent?: boolean
  }
  /** 再次打开窗口时恢复上次打开的文件标签 */
  restoreTabs: boolean
  /** 再次打开窗口时恢复上次打开的文件夹 */
  restoreFolders: boolean
  /** 工作区文件树仅显示可打开的文档类型（Markdown/纯文本），过滤后为空的文件夹一并隐藏；默认关（显示全部） */
  wsOpenableOnly: boolean
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
  /** 外观扩展（M3）：外部 CSS 主题 + 字体族。字段为空串 = 用内置默认 */
  appearance?: {
    /** 主题族键（同族文件去掉明暗/风格后缀；旧配置可能存完整文件名） */
    themeCss?: string
    /** 主题变体：auto = 跟随应用明暗（浅/深成对时）；light/dark/灰色等 = 指定变体 */
    themeVariant?: string
    /** 正文字体族（CSS font-family 值，作用于文档内容） */
    bodyFont?: string
    /** 代码字体族（CSS font-family 值，作用于代码块/行内代码） */
    codeFont?: string
  }
  /** 最近文件，新的在前 */
  recent: RecentFile[]
}

/** userData/themes 下发现的外部 CSS 主题（M3）。
 *  Typora 社区习惯把明暗做成两个文件（xxx.css / xxx-dark.css），
 *  这里把同族文件归到一个 family，应用按当前明暗自动选变体 */
export interface ThemeInfo {
  /** 文件显示名（不含 .css 扩展名；也是旧配置的兼容键） */
  name: string
  /** 文件名（含相对子目录与 .css，theme:readCss 参数） */
  file: string
  /** 同族键：去掉 -dark/-midnight/-paper/-grey 等后缀后的名字（选择时存这个） */
  family: string
  /** 该文件的明暗极性（文件名后缀优先，其次按 --bg-color 亮度判断） */
  variant: 'light' | 'dark' | 'other'
  /** 变体键：light / dark / 灰色等风格词；配色族里是颜色名（abyss/forest…） */
  variantKey: string
  /** 配色族成员：同一包目录里 ≥2 个独立主题共享段首前缀（phycat-* → phycat），
   *  设置里合成一个条目、变体行按颜色选择（variantKey 是颜色名） */
  colorFamily?: boolean
  /** 主题主色（--primary-color 等首个命中值，配色族色板用） */
  color?: string
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
 * 各窗口尺寸不同，侧栏宽度独立调整。
 */
export interface WindowPrefs {
  /** 侧栏（大纲/文件面板）宽度 px */
  sidebarWidth: number
}

export const defaultWindowPrefs: WindowPrefs = { sidebarWidth: 264 }

/** 内容列统一宽度的下限（px）：最小窗口（1280）下墨脊 52 + 侧栏最大 440 +
 *  快捷键面板 300 + 纸面左右留白 48 之后的剩余可用宽度（实测 440） */
export const CONTENT_WIDTH_MIN = 440

/** 内容列统一宽度的上限（px）：超过后只是两侧留白，无实际收益 */
export const CONTENT_WIDTH_MAX = 1600

export interface RecentFile {
  path: string
  /** 最近打开时间（epoch ms），0 表示未知 */
  ts: number
}

export const defaultConfig: AppConfig = {
  theme: 'system',
  locale: 'system',
  editor: { fontSize: 16, lineHeight: 1.7, contentWidth: 800 },
  autosave: { enabled: true, intervalMs: 15000, silent: true },
  restoreTabs: true,
  restoreFolders: true,
  wsOpenableOnly: false,
  openAtLogin: false,
  closeAction: 'quit',
  shortcuts: {},
  upload: { enabled: false, server: 'http://127.0.0.1:36677/upload' },
  vimMode: false,
  plugins: { disabled: [] },
  appearance: { themeCss: '', themeVariant: 'auto', bodyFont: '', codeFont: '' },
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
  /** 路径 → 该标签上次的编辑模式（即显/编辑/双栏/预览），恢复时逐标签还原 */
  modes?: Record<string, string>
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
  | 'file:insertImage'
  | 'file:uploadImages'
  | 'file:quickOpen'
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

/** 更新流程阶段 */
export type UpdatePhase =
  | 'idle'        // 未检查
  | 'checking'    // 检查中
  | 'available'   // 发现新版本（未下载）
  | 'none'        // 已是最新
  | 'downloading' // 下载中
  | 'downloaded'  // 已下载待装
  | 'error'       // 出错

/** 更新状态快照（主进程单源，经 update:state 全量广播） */
export interface UpdateStatePayload {
  phase: UpdatePhase
  /** 新版本号（available 之后有效） */
  version: string
  /** 更新内容（Release notes,markdown） */
  notes: string
  /** 下载进度 0-100 */
  percent: number
  /** 下载速度 bytes/s */
  bps: number
  /** 强制更新（Release notes 含标记：弹窗不可关闭） */
  force: boolean
  /** 错误原因（phase=error） */
  error: string
  /** 新版本发布时间（ISO 字符串，来自 latest.yml 的 releaseDate） */
  releaseDate: string
}
