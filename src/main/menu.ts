import { BrowserWindow, Menu, app, dialog, type MenuItemConstructorOptions } from 'electron'

/**
 * 菜单命令统一转发到聚焦窗口的渲染进程（menu:command），
 * 文档级操作（新建/保存等）由渲染进程的 documents store 决定行为。
 */
function send(win: BrowserWindow, cmd: string): void {
  if (win.isDestroyed()) return
  win.webContents.send('menu:command', cmd)
}

export function createMenu(win: BrowserWindow): void {
  const cmd = (c: string): Electron.MenuItemConstructorOptions['click'] => () => send(win, c)

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建文档', accelerator: 'CmdOrCtrl+N', click: cmd('file:new') },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: cmd('file:open') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('file:openFolder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: cmd('file:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('file:saveAs') },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: cmd('file:closeTab') },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找…', accelerator: 'CmdOrCtrl+F', click: cmd('edit:find') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换侧栏', accelerator: 'CmdOrCtrl+\\', click: cmd('view:toggleSidebar') },
        { label: '切换主题', accelerator: 'CmdOrCtrl+Alt+T', click: cmd('view:toggleTheme') },
        { label: '专注模式', accelerator: 'F8', click: cmd('view:toggleFocus') },
        { label: '打字机模式', accelerator: 'F9', click: cmd('view:toggleTypewriter') },
        { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: cmd('app:settings') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '打开功能示例文档',
          click: () => send(win, 'help:sample')
        },
        {
          label: '关于墨匣',
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: '关于墨匣',
              message: `墨匣 Inkbox v${app.getVersion()}`,
              detail: '墨匣纸面 Markdown 编辑器 · Electron + Vue\n原创界面设计，详见 DESIGN.md'
            })
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
