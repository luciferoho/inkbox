/** 应用配置（userData/config.json 持久化） */
export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  editor: {
    fontSize: number
    lineHeight: number
    /** 纸面宽度：可用宽度（窗口减去墨脊/侧栏/留白）的百分比，100 = 占满只留四周间距 */
    pageWidthPct: number
  }
  autosave: {
    enabled: boolean
    intervalMs: number
  }
  /** 侧栏（大纲/文件面板）宽度 px */
  sidebarWidth: number
  /** 最近文件，新的在前 */
  recent: RecentFile[]
}

export interface RecentFile {
  path: string
  /** 最近打开时间（epoch ms），0 表示未知 */
  ts: number
}

export const defaultConfig: AppConfig = {
  theme: 'system',
  editor: { fontSize: 16, lineHeight: 1.7, pageWidthPct: 80 },
  autosave: { enabled: true, intervalMs: 15000 },
  sidebarWidth: 264,
  recent: []
}

/** 主进程菜单/快捷键转发到渲染进程的命令 */
export type MenuCommand =
  | 'file:new'
  | 'file:open'
  | 'file:openFolder'
  | 'file:save'
  | 'file:saveAs'
  | 'file:closeTab'
  | 'view:toggleSidebar'
  | 'view:toggleTheme'
  | 'view:toggleFocus'
  | 'view:toggleTypewriter'
  | 'edit:find'
  | 'app:settings'
  | 'help:sample'

/** 文件树条目（fs:readDir 返回） */
export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}
