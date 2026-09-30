import { BrowserWindow, Menu, app, dialog, type MenuItemConstructorOptions } from 'electron'
import { m } from './i18n'

/**
 * 菜单命令转发到渲染进程（menu:command），
 * 文档级操作（新建/保存等）由渲染进程的 documents store 决定行为。
 * 多窗口：命令始终路由到当前焦点窗口（无焦点时退回创建菜单的窗口）。
 * 文案来自主进程词典，语言切换时经 rebuildMenus 重建。
 */
function send(win: BrowserWindow, cmd: string): void {
  const target = BrowserWindow.getFocusedWindow() ?? win
  if (target.isDestroyed()) return
  target.webContents.send('menu:command', cmd)
}

export function createMenu(win: BrowserWindow): void {
  const cmd = (c: string): Electron.MenuItemConstructorOptions['click'] => () => send(win, c)

  const template: MenuItemConstructorOptions[] = [
    {
      label: m('menuFile'),
      submenu: [
        { label: m('menuNew'), accelerator: 'CmdOrCtrl+N', click: cmd('file:new') },
        { label: m('menuOpen'), accelerator: 'CmdOrCtrl+O', click: cmd('file:open') },
        { label: m('menuOpenFolder'), accelerator: 'CmdOrCtrl+Shift+O', click: cmd('file:openFolder') },
        { type: 'separator' },
        { label: m('menuSave'), accelerator: 'CmdOrCtrl+S', click: cmd('file:save') },
        { label: m('menuSaveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: cmd('file:saveAs') },
        { label: m('menuExport'), accelerator: 'CmdOrCtrl+E', click: cmd('file:export') },
        { label: m('menuCloseTab'), accelerator: 'CmdOrCtrl+W', click: cmd('file:closeTab') },
        { label: m('menuNextTab'), accelerator: 'CmdOrCtrl+Tab', click: cmd('file:nextTab') },
        { label: m('menuPrevTab'), accelerator: 'CmdOrCtrl+Shift+Tab', click: cmd('file:prevTab') },
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
        { label: m('menuFind'), accelerator: 'CmdOrCtrl+F', click: cmd('edit:find') }
      ]
    },
    {
      label: m('mView'),
      submenu: [
        { label: m('mToggleSidebar'), accelerator: 'CmdOrCtrl+\\', click: cmd('view:toggleSidebar') },
        { label: m('mToggleTheme'), accelerator: 'CmdOrCtrl+Alt+T', click: cmd('view:toggleTheme') },
        { label: m('mFocus'), accelerator: 'F8', click: cmd('view:toggleFocus') },
        { label: m('mTypewriter'), accelerator: 'F9', click: cmd('view:toggleTypewriter') },
        { label: m('mZen'), accelerator: 'F10', click: cmd('view:toggleZen') },
        { label: m('mSearch'), accelerator: 'CmdOrCtrl+Shift+F', click: cmd('view:toggleSearch') },
        { label: m('mSettings'), accelerator: 'CmdOrCtrl+,', click: cmd('app:settings') },
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
