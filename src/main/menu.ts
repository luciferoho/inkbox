import { BrowserWindow, Menu, app, dialog, type MenuItemConstructorOptions } from 'electron'
import { m } from './i18n'
import { effectiveShortcuts, type ShortcutOverrides } from '@shared/shortcuts'
import type { MenuCommand } from '@shared/types'

/**
 * 菜单命令转发到渲染进程（menu:command），
 * 文档级操作（新建/保存等）由渲染进程的 documents store 决定行为。
 * 多窗口：命令始终路由到当前焦点窗口（无焦点时退回创建菜单的窗口）。
 * 文案来自主进程词典，语言切换时经 rebuildMenus 重建。
 * 加速键按配置覆盖表生效（6.7 快捷键自定义）：改键后由 config IPC 触发重建。
 */
function send(win: BrowserWindow, cmd: string): void {
  const target = BrowserWindow.getFocusedWindow() ?? win
  if (target.isDestroyed()) return
  target.webContents.send('menu:command', cmd)
}

/* 覆盖表由 config 层注入（避免 menu ↔ config 循环依赖）；
   suspended = 改键录制期间摘掉菜单，加速器不再拦截按键，渲染层才能收到原始 keydown */
let overrides: ShortcutOverrides | null = null
let suspended = false
let resumeTimer: NodeJS.Timeout | null = null

export function setShortcutOverrides(o: ShortcutOverrides | undefined | null): void {
  overrides = o ?? null
}

/** 录制开始挂起 / 结束恢复；60s 兜底自动恢复（渲染层异常未发结束信号时不至于全键失效） */
export function setMenuSuspended(on: boolean): void {
  if (on === suspended) return
  suspended = on
  if (resumeTimer) {
    clearTimeout(resumeTimer)
    resumeTimer = null
  }
  if (on) {
    Menu.setApplicationMenu(null)
    resumeTimer = setTimeout(() => setMenuSuspended(false), 60_000)
  } else {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) createMenu(win)
    }
  }
}

export function createMenu(win: BrowserWindow): void {
  if (suspended) return
  const cmd = (c: string): Electron.MenuItemConstructorOptions['click'] => () => send(win, c)
  const eff = effectiveShortcuts(overrides ?? undefined)
  /** id 用于 dev 调试钩子（debugMenuAccels/Invoke）定位活体菜单项 */
  const item = (id: MenuCommand, label: string): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator: eff[id] || undefined,
    click: cmd(id)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: m('menuFile'),
      submenu: [
        item('file:new', m('menuNew')),
        item('file:open', m('menuOpen')),
        item('file:openFolder', m('menuOpenFolder')),
        { type: 'separator' },
        item('file:save', m('menuSave')),
        item('file:saveAs', m('menuSaveAs')),
        item('file:export', m('menuExport')),
        item('file:closeTab', m('menuCloseTab')),
        item('file:nextTab', m('menuNextTab')),
        item('file:prevTab', m('menuPrevTab')),
        { type: 'separator' },
        { role: 'quit', label: m('menuQuit') }
      ]
    },
    {
      label: m('menuEdit'),
      submenu: [
        { role: 'undo', label: m('menuUndo') },
        { role: 'redo', label: m('menuRedo') },
        { type: 'separator' },
        { role: 'cut', label: m('menuCut') },
        { role: 'copy', label: m('menuCopy') },
        { role: 'paste', label: m('menuPaste') },
        { role: 'selectAll', label: m('menuSelectAll') },
        { type: 'separator' },
        item('edit:find', m('menuFind'))
      ]
    },
    {
      label: m('mView'),
      submenu: [
        item('view:toggleSidebar', m('mToggleSidebar')),
        item('view:toggleTheme', m('mToggleTheme')),
        item('view:toggleFocus', m('mFocus')),
        item('view:toggleTypewriter', m('mTypewriter')),
        item('view:toggleZen', m('mZen')),
        item('view:toggleSearch', m('mSearch')),
        item('app:settings', m('mSettings')),
        { type: 'separator' },
        { role: 'resetZoom', label: m('mActualSize') },
        { role: 'zoomIn', label: m('mZoomIn') },
        { role: 'zoomOut', label: m('mZoomOut') },
        { role: 'togglefullscreen', label: m('mFullscreen') },
        { type: 'separator' },
        { role: 'toggleDevTools', label: m('mDevTools') }
      ]
    },
    {
      label: m('mHelp'),
      submenu: [
        {
          label: m('mSample'),
          click: () => send(win, 'help:sample')
        },
        {
          label: m('mAbout'),
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: m('mAbout'),
              message: `${m('aboutBrand')} v${app.getVersion()}`,
              detail: m('aboutDetail')
            })
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ---------- dev-only 验证钩子（打包版不注册 IPC）：本环境注入不了真实键击，
   通过活体菜单读取加速器/触发 click，覆盖"注册了什么加速器"与"命令管线"两环 ---------- */

export function debugMenuAccels(): Record<string, string | null> {
  const menu = Menu.getApplicationMenu()
  const out: Record<string, string | null> = {}
  const walk = (items: Electron.MenuItem[]): void => {
    for (const it of items) {
      if (it.id) out[it.id] = it.accelerator ?? null
      if (it.submenu) walk(it.submenu.items)
    }
  }
  if (menu) walk(menu.items)
  return out
}

export function debugMenuInvoke(id: string): boolean {
  const it = Menu.getApplicationMenu()?.getMenuItemById(id)
  if (!it) return false
  it.click()
  return true
}
