import { BrowserWindow, app } from 'electron'
import type { AppConfig } from '@shared/types'

/**
 * 主进程界面文案（菜单/托盘/系统对话框/更新通知）。
 * 与渲染层 i18n 相互独立：语言偏好经 app:setLocale 同步，
 * 切换后重建菜单与托盘菜单；启动时由 config 调 applyLocaleFromConfig。
 */

type Locale = Exclude<AppConfig['locale'], 'system'>

const zh = {
  // 菜单
  menuFile: '文件',
  menuNew: '新建文档',
  menuOpen: '打开文件…',
  menuOpenFolder: '打开文件夹…',
  menuSave: '保存',
  menuSaveAs: '另存为…',
  menuExport: '导出…',
  menuCloseTab: '关闭标签页',
  menuNextTab: '下一标签',
  menuPrevTab: '上一标签',
  menuQuit: '退出',
  menuEdit: '编辑',
  menuUndo: '撤销',
  menuRedo: '重做',
  menuCut: '剪切',
  menuCopy: '复制',
  menuPaste: '粘贴',
  menuSelectAll: '全选',
  menuFind: '查找…',
  mView: '视图',
  mToggleSidebar: '切换侧栏',
  mToggleTheme: '切换主题',
  mFocus: '专注模式',
  mTypewriter: '打字机模式',
  mZen: '禅模式',
  mSearch: '全局搜索…',
  mSettings: '偏好设置…',
  mActualSize: '实际大小',
  mZoomIn: '放大',
  mZoomOut: '缩小',
  mFullscreen: '全屏',
  mDevTools: '开发者工具',
  mHelp: '帮助',
  mSample: '打开功能示例文档',
  mAbout: '关于墨匣',
  aboutBrand: '墨匣 Inkbox',
  aboutDetail: '墨匣纸面 Markdown 编辑器 · Electron + Vue\n原创界面设计，详见 DESIGN.md',
  // 托盘
  trayTooltip: '墨匣 Inkbox · 落笔即章',
  trayOpen: '打开墨匣',
  trayQuit: '退出',
  // 系统对话框
  dlgOpenMd: '打开 Markdown 文件',
  dlgAllFiles: '所有文件',
  dlgOpenFolder: '打开文件夹作为工作区',
  dlgSaveMd: '保存 Markdown 文件',
  dlgExportHtml: '导出 HTML',
  dlgExportPdf: '导出 PDF',
  dlgExportPng: '导出 PNG 长图',
  dlgUntitledMd: '未命名.md',
  dlgUntitledPdf: '未命名.pdf',
  dlgUntitledPng: '未命名.png',
  // 更新通知
  updateTitle: '墨匣 Inkbox',
  updateBody: '新版本已就绪，退出应用后自动安装'
}

const en: typeof zh = {
  menuFile: 'File',
  menuNew: 'New Document',
  menuOpen: 'Open File…',
  menuOpenFolder: 'Open Folder…',
  menuSave: 'Save',
  menuSaveAs: 'Save As…',
  menuExport: 'Export…',
  menuCloseTab: 'Close Tab',
  menuNextTab: 'Next Tab',
  menuPrevTab: 'Previous Tab',
  menuQuit: 'Quit',
  menuEdit: 'Edit',
  menuUndo: 'Undo',
  menuRedo: 'Redo',
  menuCut: 'Cut',
  menuCopy: 'Copy',
  menuPaste: 'Paste',
  menuSelectAll: 'Select All',
  menuFind: 'Find…',
  mView: 'View',
  mToggleSidebar: 'Toggle Sidebar',
  mToggleTheme: 'Toggle Theme',
  mFocus: 'Focus Mode',
  mTypewriter: 'Typewriter Mode',
  mZen: 'Zen Mode',
  mSearch: 'Search in Workspace…',
  mSettings: 'Preferences…',
  mActualSize: 'Actual Size',
  mZoomIn: 'Zoom In',
  mZoomOut: 'Zoom Out',
  mFullscreen: 'Fullscreen',
  mDevTools: 'Developer Tools',
  mHelp: 'Help',
  mSample: 'Open Feature Tour',
  mAbout: 'About Inkbox',
  aboutBrand: 'Inkbox',
  aboutDetail: 'Inkbox Paper Markdown editor · Electron + Vue\nOriginal UI design, see DESIGN.md',
  trayTooltip: 'Inkbox · Write, flow',
  trayOpen: 'Open Inkbox',
  trayQuit: 'Quit',
  dlgOpenMd: 'Open Markdown File',
  dlgAllFiles: 'All Files',
  dlgOpenFolder: 'Open Folder as Workspace',
  dlgSaveMd: 'Save Markdown File',
  dlgExportHtml: 'Export HTML',
  dlgExportPdf: 'Export PDF',
  dlgExportPng: 'Export PNG Image',
  dlgUntitledMd: 'Untitled.md',
  dlgUntitledPdf: 'Untitled.pdf',
  dlgUntitledPng: 'Untitled.png',
  updateTitle: 'Inkbox',
  updateBody: 'A new version is ready — it will install when you quit the app'
}

const dicts: Record<Locale, typeof zh> = { 'zh-CN': zh, en }

let current: Locale = 'zh-CN'

/** system 偏好解析：Electron 自带系统 locale（渲染层用 navigator.language，口径一致） */
export function resolveSystemLocale(): Locale {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function setLocale(pref: AppConfig['locale']): void {
  current = pref === 'system' ? resolveSystemLocale() : pref
}

export function locale(): Locale {
  return current
}

/** 取当前语言的文案：m(key) ≈ 主进程版 t() */
export function m<K extends keyof typeof zh>(key: K): (typeof zh)[K] {
  return dicts[current][key]
}

/** 启动时从持久化配置应用语言（config.json 读取失败时保持默认中文） */
export function applyLocaleFromConfig(readLocale: () => AppConfig['locale']): void {
  try {
    setLocale(readLocale())
  } catch {
    setLocale('system')
  }
}

/** 语言切换后重建所有窗口菜单（托盘由调用方单独重建） */
export function rebuildMenus(createMenu: (win: BrowserWindow) => void): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) createMenu(win)
  }
}
