/**
 * 中文词典（键的唯一定义源）。
 * 扁平点号键：`as const` 推导出的键联合给 en.ts 做穷举校验，
 * 也供 i18n/index.ts 的类型化 t() 使用。
 * 注意 vue-i18n 消息语法：{} 为插值占位，文案里不要出现字面量 { } @ |
 */
export const zh = {
  // 通用
  'common.ok': '确定',
  'common.cancel': '取消',
  'common.on': '开',
  'common.off': '关',
  'common.close': '关闭',
  'common.delete': '删除',

  // 关窗 / 应用级（App.vue）
  'app.exportNoDoc': '请先打开要导出的文档',
  'app.draftsRestored': '检测到异常退出，已恢复 {n} 份未保存的内容',
  'app.closeTitle': '有未保存的文档',
  'app.closeMsg': '还有 {n} 个文档未保存，未保存的内容已自动备份。',
  'app.discard': '直接退出',
  'app.saveQuit': '保存并退出',

  // 文档 store
  'docs.home': '主页',
  'docs.untitled': '未命名-{n}',
  'docs.saved': '已保存 {name}',
  'docs.saveFailed': '保存失败：{name}',
  'docs.openFailed': '打开失败：{path}',
  'docs.openedElsewhere': '「{name}」已在另一个窗口打开',
  'docs.closeDirtyTitle': '未保存的修改',
  'docs.closeDirtyMsg': '「{name}」有未保存的修改，确定关闭吗？',
  'docs.discardClose': '放弃修改并关闭',
  'docs.fileGone': '文件已被外部删除或移动：{name}',
  'docs.reloaded': '已重新加载外部修改：{name}',
  'docs.extTitle': '文件已被外部修改',
  'docs.extMsg': '「{name}」在磁盘上已被其他程序修改。\n重新加载将覆盖当前未保存的修改。',
  'docs.reload': '重新加载',
  'docs.draftsRestoredN': '已恢复 {n} 份未保存的内容',

  // UI store
  'ui.ready': '就绪',
  'ui.focusOn': '专注模式已开启（F8 关闭）',
  'ui.focusOff': '专注模式已关闭',
  'ui.typewriterOn': '打字机模式已开启（F9 关闭）',
  'ui.typewriterOff': '打字机模式已关闭',

  // 工作区 store
  'ws.newFolderDefault': '新建文件夹',
  'ws.newFileDefault': '新建文档.md',
  'ws.opFailed': '操作失败（可能已存在同名项）',
  'ws.delTitle': '删除确认',
  'ws.delDirMsg': '确定删除文件夹及其全部内容？\n{path}',
  'ws.delFileMsg': '确定删除「{name}」？\n{path}',
  'ws.deleted': '已删除',
  'ws.delFailed': '删除失败',
  'ws.closed': '已关闭工作区',

  // 标题栏
  'titlebar.brand': '墨匣',
  'titlebar.dirty': '未保存',
  'titlebar.tagline': '墨匣 Inkbox · 落笔即章',
  'titlebar.minimize': '最小化',
  'titlebar.maximize': '最大化',
  'titlebar.restore': '还原',
  'titlebar.close': '关闭',

  // 标签栏
  'tabs.home': '主页',
  'tabs.dirty': '未保存',
  'tabs.new': '新建文档 (Ctrl+N)',
  'tabs.ctxClose': '关闭标签页',
  'tabs.ctxDetach': '移到新窗口',
  'tabs.ctxCloseLeft': '关闭左侧（{n}）',
  'tabs.ctxCloseRight': '关闭右侧（{n}）',
  'tabs.ctxCloseOthers': '关闭其他',
  'tabs.ctxCloseAll': '关闭全部',
  'tabs.detached': '已在新窗口打开「{name}」',

  // 状态栏
  'status.unsaved': '未保存',
  'status.savedAt': '已保存 {time}',
  'status.words': '{n} 词',
  'status.chars': '{n} 字符',
  'status.readMin': '约 {n} 分钟',
  'status.focus': '专注',
  'status.typewriter': '打字机',
  'status.focusTitle': '专注模式 (F8)',
  'status.typewriterTitle': '打字机模式 (F9)',
  'status.autosaveOn': '自动保存',
  'status.autosaveOff': '自动保存已关',
  'status.lineTitle': '第 {n} 行',

  // 欢迎页
  'welcome.hero': '落笔即章',
  'welcome.sub': '墨匣纸面 · 即时渲染 Markdown 编辑器',
  'welcome.newDoc': '新建文档',
  'welcome.openFile': '打开文件',
  'welcome.openFolder': '打开文件夹',
  'welcome.sample': '功能示例',
  'welcome.recent': '最近打开',
  'welcome.recentEmpty1': '暂无最近打开的文件',
  'welcome.recentEmpty2': '打开或保存的文档会出现在这里',
  'welcome.removeRecent': '从最近列表移除（不删除文件）',
  'welcome.removedRecent': '已从最近列表移除',
  'welcome.justNow': '刚刚',
  'welcome.minAgo': '{n} 分钟前',
  'welcome.hourAgo': '{n} 小时前',
  'welcome.dayAgo': '{n} 天前',
  'welcome.unsavedPath': '尚未保存到磁盘',

  // 编辑模式
  'mode.wysiwyg': '即显',
  'mode.edit': '编辑',
  'mode.split': '双栏',
  'mode.preview': '预览',
  'mode.tipWysiwyg': '所见即所得（即时渲染）',
  'mode.tipEdit': '源码模式',
  'mode.tipSplit': '源码 + 预览',
  'mode.tipPreview': '纯预览',

  // 侧栏
  'side.outline': '大纲',
  'side.files': '工作区',
  'side.collapse': '折叠侧栏 (Ctrl+\\)',
  'side.resizeHint': '拖动调整宽度 · 双击折叠',
  'side.outlineEmpty': '打开文档后，这里会显示标题结构树。',
  'side.outlineNoHeadings': '文档中还没有标题。',
  'side.outlineHint':
    '用 <kbd>#</kbd> 到 <kbd>######</kbd> 创建标题，或 <kbd>Ctrl</kbd>+<kbd>=</kbd> 提升标题级别。',
  'side.filesEmpty': '将文件夹设为工作区，在此浏览与管理笔记。',
  'side.openFolder': '打开文件夹',
  'side.newDoc': '新建文档',
  'side.newFolder': '新建文件夹',
  'side.openOther': '打开其他文件夹',
  'side.closeWs': '关闭工作区（保留已打开的标签）',
  'side.phFolder': '文件夹名',
  'side.phFile': '文档名.md',

  // 编辑器（源码模式）
  'editor.saveFirstForImage': '请先保存文档，再粘贴图片',
  'editor.imageSaveFailed': '图片保存失败：{name}',
  'editor.imagesInserted': '已插入 {n} 张图片到 {dir}/',

  // 大纲节点 / 文件树节点
  'outline.untitled': '（无标题文字）',
  'tree.rename': '重命名',

  // 快捷键面板
  'sc.title': '快捷键',
  'sc.collapse': '收起面板',
  'sc.gCommon': '常用',
  'sc.gEdit': '编辑与格式',
  'sc.gWysiwyg': '即显模式 · 代码块',
  'sc.newDoc': '新建文档',
  'sc.openFile': '打开文件',
  'sc.openFolder': '打开文件夹',
  'sc.save': '保存',
  'sc.saveAs': '另存为',
  'sc.export': '导出 HTML / PDF',
  'sc.closeTab': '关闭标签页',
  'sc.cycleTab': '下一 / 上一标签',
  'sc.toggleSidebar': '折叠/展开侧栏',
  'sc.settings': '偏好设置',
  'sc.find': '查找替换',
  'sc.bold': '粗体',
  'sc.italic': '斜体',
  'sc.link': '链接',
  'sc.strike': '删除线',
  'sc.inlineCode': '行内代码',
  'sc.heading': '标题升级 / 降级',
  'sc.focusTypewriter': '专注 / 打字机模式',
  'sc.indent': '缩进 / 反缩进',
  'sc.exitCode': '退出代码块',
  'sc.afterCode': '代码块后接续正文',

  // 墨脊
  'rail.outline': '大纲',
  'rail.files': '工作区',
  'rail.search': '搜索',
  'rail.theme': '切换主题 (Ctrl+Alt+T)',
  'rail.shortcuts': '快捷键说明',
  'rail.settings': '偏好设置 (Ctrl+,)',

  // 图片查看器
  'viewer.hint': '滚轮缩放 · 拖拽移动 · 双击复位 · Esc 关闭',
  'viewer.close': '关闭 (Esc)',

  // 预览
  'preview.empty': '开始输入后，这里会实时渲染预览。',

  // 导出对话框
  'export.title': '导出文档',
  'export.fileName': '文件名',
  'export.nameRequired': '请填写导出文件名',
  'export.format': '格式',
  'export.margin': '页边距',
  'export.mNormal': '标准',
  'export.mNarrow': '窄',
  'export.mNone': '无',
  'export.orient': '方向',
  'export.portrait': '纵向',
  'export.landscape': '横向',
  'export.pageNumbers': '页脚页码',
  'export.hintHtml': '单文件 HTML：样式、公式字体与本地图片全部内联，可直接分享或打开。',
  'export.hintPdf': '以预览排版经打印管线生成 A4 PDF，保留墨块代码与图表背景；开启页码时底部自动留白。',
  'export.do': '导出',
  'export.doing': '导出中…',
  'export.generating': '正在生成预览…',
  'export.previewFailed': '预览生成失败，请重试或调整设置',
  'export.nothingToPreview': '没有可预览的内容',
  'export.preparing': '正在准备预览…',
  'export.pagesHint': '仅预览前 {n} 页，共 {total} 页',
  'export.savedHtml': '已导出 HTML：{name}',
  'export.savedPdf': '已导出 PDF：{name}',
  'export.emptyDoc': '空文档无需导出',
  'export.failedRetry': '导出失败，请重试',

  // 偏好设置
  'settings.title': '偏好设置',
  'settings.closeEsc': '关闭 (Esc)',
  'settings.gAppearance': '外观',
  'settings.gLayout': '排版',
  'settings.gStartup': '启动',
  'settings.gWindow': '窗口',
  'settings.gEditor': '编辑',
  'settings.theme': '主题',
  'settings.thSystem': '跟随系统',
  'settings.thLight': '浅色',
  'settings.thDark': '深色',
  'settings.language': '语言',
  'settings.lSystem': '跟随系统',
  'settings.fontSize': '正文字号',
  'settings.lineHeight': '行距',
  'settings.pageWidth': '纸面宽度',
  'settings.pwHint': '按本窗口可用宽度百分比缩放，各窗口独立调整、互不同步；{min}%–100%，100% 时只保留四周间距。',
  'settings.restoreTabs': '恢复标签',
  'settings.restoreFolders': '恢复文件夹',
  'settings.startupHint':
    '再次打开窗口时，恢复上次打开的文件标签与工作区文件夹。异常退出后下次启动会自动恢复全部内容（含未保存的修改）。',
  'settings.closeAction': '关闭按钮',
  'settings.cQuit': '退出程序',
  'settings.cTray': '最小化到托盘',
  'settings.closeHint': '「最小化到托盘」时点关闭仅隐藏窗口，从托盘图标重新打开或退出。',
  'settings.autosave': '自动保存',
  'settings.interval': '保存间隔',
  'settings.sec': '{n} 秒'
} as const

/** 词典形状：键必须逐一对齐，值放宽为 string（en.ts 缺键/多键都在编译期报错） */
export type MsgSchema = { [K in keyof typeof zh]: string }
export type MsgKey = keyof typeof zh
