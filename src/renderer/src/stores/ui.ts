import { defineStore } from 'pinia'
import { defaultConfig, type AppConfig, type PluginCommand, type PluginInfo, type UpdateStatePayload, type WindowPrefs } from '@shared/types'
import type { ShortcutOverrides } from '@shared/shortcuts'
import { i18n, resolveLocale, t, type LocalePref } from '@/i18n'
import { setTypographer } from '@/services/markdown'
import { useDocumentsStore } from './documents'

export type ThemePref = 'light' | 'dark' | 'system'
export type SidebarMode = 'outline' | 'files' | 'search'
export type EditorMode = 'wysiwyg' | 'edit' | 'split' | 'preview'

/** 界面状态：主题 / 侧栏 / 编辑模式 / 窗口态 / 状态栏消息 / 跨组件请求 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    themePref: 'system' as ThemePref,
    /** 语言偏好（system 跟随系统）；生效值由 i18n 实例持有 */
    localePref: 'system' as LocalePref,
    effectiveTheme: 'light' as 'light' | 'dark',
    sidebarOpen: true,
    sidebarMode: 'outline' as SidebarMode,
    editorMode: 'split' as EditorMode,
    maximized: false,
    /** 窗口固定（始终置顶），由主进程 win:state 广播同步 */
    alwaysOnTop: false,
    /** 更新流程状态快照（主进程单源，update:state 广播） */
    updateState: { phase: 'idle', version: '', notes: '', percent: 0, bps: 0, force: false, error: '' } as UpdateStatePayload,
    /** 更新弹窗开关 */
    updateDialogOpen: false,
    /** 已跳过的更新版本（不再自动提示;设置里手动检查不受影响） */
    skippedUpdateVersion: localStorage.getItem('inkbox:skippedUpdateVersion') ?? '',
    /** 本次检查是否由用户主动发起（主动检查的结果用 toast 呈现；启动自动检查保持静默） */
    updateCheckByUser: false,
    focusMode: false,
    typewriterMode: false,
    /** 禅模式：隐藏标签栏/状态栏/侧栏，Esc 或菜单退出 */
    zenMode: false,
    /* 禅模式进入前的侧栏状态，退出时恢复 */
    _zenPrevSidebar: false as boolean,
    autosaveEnabled: true,
    autosaveIntervalMs: 15000,
    /* 静默保存：自动保存成功不弹「已保存」toast（手动保存不受影响），默认开 */
    autosaveSilent: true,
    /* 再次打开窗口时恢复上次打开的文件标签（默认开） */
    restoreTabs: true,
    /* 再次打开窗口时恢复上次打开的文件夹（默认开） */
    restoreFolders: true,
    /* 工作区文件树仅显示可打开的文档类型（默认关 = 显示全部文件） */
    wsOpenableOnly: false,
    /* 登录系统后自动启动（主进程写系统登录项，仅打包后生效） */
    openAtLogin: false,
    /* 点窗口关闭按钮的行为：quit = 退出程序；tray = 最小化到托盘 */
    closeAction: 'quit' as 'quit' | 'tray',
    /* 应用级命令快捷键覆盖（shared/shortcuts 注册表之外用默认值） */
    shortcuts: {} as ShortcutOverrides,
    /* 图床上传（PicGo server 协议）：粘贴/拖拽/插入图片先传图床，失败回退本地 */
    upload: { enabled: false, server: 'http://127.0.0.1:36677/upload' },
    /* Vim 模式（源码/双栏）：动态装卸 vim 键位扩展 */
    vimMode: false,
    /* Vim 插入态（状态栏徽标；SourceEditor 的 updateListener 回报） */
    vimInsert: false,
    /* 插件（6.9）：扫描发现 / 被禁用 id / 运行期错误 / 注入的命令 */
    plugins: [] as PluginInfo[],
    pluginsDisabled: [] as string[],
    pluginErrors: {} as Record<string, string>,
    pluginCommands: [] as PluginCommand[],
    statusMessage: t('ui.ready'),
    /* 编辑器跨组件请求（计数器/序列号触发 watch） */
    findRequest: 0,
    jumpLine: null as { line: number; seq: number } | null,
    currentLine: 1,
    /* 视口顶部所在行号（随滚动更新，与光标 currentLine 分离）：大纲高亮跟随 */
    viewLine: 1,
    /* 跳转期间（滚动动画）锁定 viewLine 更新：点击瞬间高亮目标项，
       不让动画初期的滚动事件把高亮拽回旧章节 */
    viewLineLockUntil: 0,
    /* 光标/内容变化序号：同一行连续输入时 currentLine 不变，预览靠它触发跟随 */
    caretSeq: 0,
    /* 弹层 */
    settingsOpen: false,
    exportOpen: false,
    viewerImage: null as string | null,
    /* 外部修改重载信号：编辑器 watch 该序号后从 store 重新整档同步 */
    extReloadSeq: 0,
    /* 右侧快捷键面板 */
    shortcutPanelOpen: false,
    /* Quick Open 快速打开（Ctrl+P，模糊搜索工作区文件名） */
    quickOpenOpen: false,
    /* 保存状态（状态栏实时展示，替代易过期的"已保存"文本提示） */
    saveState: 'clean' as 'clean' | 'dirty' | 'saved',
    savedAt: 0,
    /* 轻提示（Toast，3 秒自动消失） */
    toast: '',
    _toastTimer: 0,
    /* 自绘确认弹框 */
    confirm:
      null as null | {
        title: string
        message: string
        okText: string
        cancelText: string
        danger: boolean
        resolve: (ok: boolean) => void
      },
    /* 自绘多选弹框（如关窗时的 保存/直接退出/取消） */
    choice:
      null as null | {
        title: string
        message: string
        choices: { text: string; value: string; danger?: boolean }[]
        resolve: (value: string) => void
      },
    /* 排版偏好（全局：字号/行距；纸宽为窗口私有，见 winPrefs） */
    editorPrefs: { fontSize: 16, lineHeight: 1.7 } as AppConfig['editor'],
    /* 窗口私有偏好：各窗口尺寸不同，纸宽/侧栏宽独立调整、不同步 */
    winPrefs: { pageWidthPct: 80, sidebarWidth: 264 } as WindowPrefs,
    /* 纸宽滑杆的动态最小值（保证纸面不窄于 620px，随窗口/侧栏状态变化） */
    pageWidthMinPct: 50,
    /* 外观扩展（M3）：外部 CSS 主题 + 字体族；'' = 内置默认 */
    appearance: { themeCss: '', themeVariant: 'auto', bodyFont: '', codeFont: '' },
    /* 单变体主题锁定：主题只提供浅色/深色其一时，主题切换锁定到该模式并禁用 */
    themeLock: null as 'light' | 'dark' | null,
    /* 明暗切换禁用（单变体主题，或多变体主题固定了某个变体）：按钮置灰、快捷键无效 */
    themeSwitchLocked: false
  }),
  actions: {
    /** 跳过指定更新版本：不再自动提示（设置里手动检查不受影响） */
    skipUpdate(version: string): void {
      this.skippedUpdateVersion = version
      localStorage.setItem('inkbox:skippedUpdateVersion', version)
    },
    async init(): Promise<void> {
      const cfg = await window.api.app.getConfig()
      this.applyConfig(cfg)
      this.updatePageWidthMin()
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', () => {
          if (this.themePref === 'system') this.applyTheme()
        })
      window.addEventListener('resize', () => this.updatePageWidthMin())
    },
    applyConfig(cfg: AppConfig): void {
      this.themePref = cfg.theme
      this.localePref = cfg.locale ?? 'system'
      i18n.global.locale.value = resolveLocale(this.localePref)
      this.autosaveEnabled = cfg.autosave.enabled
      this.autosaveIntervalMs = Math.max(3000, cfg.autosave.intervalMs)
      this.autosaveSilent = cfg.autosave.silent ?? true
      this.restoreTabs = cfg.restoreTabs ?? true
      this.restoreFolders = cfg.restoreFolders ?? true
      this.wsOpenableOnly = cfg.wsOpenableOnly ?? false
      this.openAtLogin = cfg.openAtLogin ?? false
      this.closeAction = cfg.closeAction ?? 'quit'
      this.shortcuts = cfg.shortcuts ?? {}
      this.upload = { ...defaultConfig.upload, ...cfg.upload }
      this.vimMode = cfg.vimMode ?? false
      this.pluginsDisabled = cfg.plugins?.disabled ?? []
      this.editorPrefs = { ...cfg.editor }
      const a = cfg.appearance ?? {}
      this.appearance = {
        themeCss: a.themeCss ?? '',
        themeVariant: a.themeVariant ?? 'auto',
        bodyFont: a.bodyFont ?? '',
        codeFont: a.codeFont ?? ''
      }
      this.applyTheme()
      this.applyEditorPrefs()
      // 智能标点 + 拼写检查初始态（markdown 单例与编辑器宿主属性）
      setTypographer(!!this.editorPrefs.typographer)
      this.applySpellcheck()
      void this.syncThemeLock()
      // 外观扩展（M3）：外部主题 CSS/字体族/用户 CSS；异步注入，不阻塞首帧
      void import('@/services/appearance').then((m) => m.applyAppearanceConfig(cfg))
      // 插件发现/禁用表可能变了：动态 import 避免与 pluginHost 形成模块环
      void import('@/services/pluginHost').then((m) => m.syncPlugins())
    },
    /** 窗口私有偏好：启动时（拿到窗口键后）与本地调整时应用，不参与跨窗口同步 */
    applyWindowPrefs(p: WindowPrefs): void {
      this.winPrefs = { ...p }
      this.applyEditorPrefs()
      this.applySidebarWidth()
      this.updatePageWidthMin()
    },
    applySidebarWidth(): void {
      document.documentElement.style.setProperty('--sidebar-width', `${this.winPrefs.sidebarWidth}px`)
    },
    /** 拖拽过程实时调宽（落盘在拖拽结束时统一走 persistSidebarWidth） */
    resizeSidebarLive(width: number): void {
      this.winPrefs.sidebarWidth = Math.min(440, Math.max(200, Math.round(width)))
      this.applySidebarWidth()
      this.updatePageWidthMin()
    },
    async persistSidebarWidth(): Promise<void> {
      await window.api.app.setWindowPrefs(useDocumentsStore().windowKey, {
        sidebarWidth: this.winPrefs.sidebarWidth
      })
    },
    /** 排版偏好 → CSS 变量。纸宽为可用宽度百分比（100% = 占满可用宽度，只留四周间距） */
    applyEditorPrefs(): void {
      const { fontSize, lineHeight } = this.editorPrefs
      const { pageWidthPct } = this.winPrefs
      const root = document.documentElement.style
      root.setProperty('--preview-font-size', `${fontSize}px`)
      root.setProperty('--preview-line-height', String(lineHeight))
      root.setProperty('--editor-font-size', `${Math.max(11, fontSize - 2.5)}px`)
      root.setProperty('--editor-line-height', String(lineHeight))
      root.setProperty('--paper-width', `${pageWidthPct}%`)
    },
    /** 拼写检查（4.2，可选开关）：编辑器宿主 spellcheck 属性即时切换；
       广播事件供编辑器重挂载后重新应用（PM/CM 创建时硬编码 false）。
       预览正文以「可编辑但拒绝一切输入」的方式参与拼写扫描（纯静态 DOM
       Chromium 不扫），beforeinput 已在 Preview 挂载时全拦，观感只读。
     *  Chromium 词典只标英文错词，中文文本不参与（脚本检测跳过），不会满屏红线 */
    applySpellcheck(): void {
      const v = this.editorPrefs.spellcheck ? 'true' : 'false'
      for (const el of document.querySelectorAll<HTMLElement>('.ProseMirror, .cm-content')) {
        el.setAttribute('spellcheck', v)
      }
      for (const el of document.querySelectorAll<HTMLElement>('.md-preview')) {
        el.setAttribute('spellcheck', v)
        el.contentEditable = this.editorPrefs.spellcheck ? 'true' : 'false'
      }
      window.dispatchEvent(new CustomEvent('inkbox:spellcheck', { detail: v }))
    },
    /** 重算纸宽滑杆最小值：保证纸面物理宽度不小于 620px（随窗口/侧栏状态变化） */
    updatePageWidthMin(): void {
      const rail = 52
      const panel = this.sidebarOpen ? this.winPrefs.sidebarWidth : 0
      const pad = 50 // paper-scroll 左右留白 + 纸卡边框
      const available = Math.max(320, window.innerWidth - rail - panel - pad)
      this.pageWidthMinPct = Math.min(90, Math.max(40, Math.ceil((620 / available) * 100)))
    },
    /** 字号/行距（全局，跨窗口同步）；纸宽走 setPageWidth（窗口私有）。
     *  注意必须展开成普通对象：editorPrefs 是 reactive 代理，Proxy 过不了
     *  IPC 结构化克隆（invoke 静默失败），设置会"看着生效实则没保存" */
    async setEditorPrefs(patch: Partial<AppConfig['editor']>): Promise<void> {
      const spellBefore = this.editorPrefs.spellcheck
      this.editorPrefs = { ...this.editorPrefs, ...patch }
      this.applyEditorPrefs()
      // 智能标点必须先切 flag 再触发重渲染（Preview watch 在本函数返回前就会跑）
      setTypographer(!!this.editorPrefs.typographer)
      await window.api.app.setConfig({ editor: { ...this.editorPrefs } })
      this.applySpellcheck()
      // 拼写检查开关即时重扫：Chromium 只在焦点/编辑时渐进扫描，若不扰动，
      // 已有内容的波浪线要等光标走到才会出现
      if (patch.spellcheck !== undefined && patch.spellcheck !== spellBefore) {
        this.rescanSpellcheck()
      }
    },

    /** 触发焦点编辑器立即重扫拼写：Chromium 对 spellcheck 属性翻转才做
     *  全量重扫（selection 变化不够），三连扰动——attr 往返 + reflow +
     *  blur/focus，光标由 PM/CM 的 selection 同步自动恢复 */
    rescanSpellcheck(): void {
      for (const el of document.querySelectorAll<HTMLElement>('.ProseMirror, .cm-content')) {
        if (!document.activeElement || !el.contains(document.activeElement)) continue
        try {
          el.setAttribute('spellcheck', 'false')
          void el.offsetHeight // reflow：确保属性翻转被排版管线消费
          el.setAttribute('spellcheck', 'true')
          const hadFocus = el.contains(document.activeElement)
          if (hadFocus) {
            el.blur()
            el.focus()
          }
        } catch {
          /* 扰动失败不致命 */
        }
        break
      }
    },
    /** 外观扩展（M3）：主题样式/字体族。广播后各窗口 applyConfig 重注入 */
    async setAppearance(patch: Partial<AppConfig['appearance']>): Promise<void> {
      this.appearance = { ...this.appearance, ...patch }
      // 代理过不了 IPC 结构化克隆，必须展开成普通对象（同 setEditorPrefs）
      await window.api.app.setConfig({ appearance: { ...this.appearance } })
      await this.syncThemeLock()
    },
    /** 单变体主题：把主题锁定到它自身的浅/深模式（应用切换按钮随之禁用）。
     *  浅+深成对（或含灰色等第三变体）时不锁定；内置主题不锁定。 */
    async syncThemeLock(): Promise<void> {
      const key = this.appearance.themeCss
      const variant = this.appearance.themeVariant || 'auto'
      if (!key) {
        this.themeLock = null
        this.themeSwitchLocked = false
        await this.applyPersistedThemePref()
        return
      }
      const list = await window.api.theme.list()
      const entries = list.filter((t) => t.family === key)
      const family = entries.length ? entries : list.filter((t) => t.name === key)
      const hasLight = family.some((t) => t.variant === 'light')
      const hasDark = family.some((t) => t.variant === 'dark')
      const pinned = variant !== 'auto'
      let lock: 'light' | 'dark' | null = null
      if (family.length === 1) {
        // 单变体主题：能判定浅/深就强制该模式；灰色等风格变体只禁用切换
        const only = family[0]
        if (only.variant === 'light' || only.variant === 'dark') lock = only.variant
        this.themeSwitchLocked = true
      } else if (pinned) {
        // 多主题但用户固定了变体：明暗切换不再影响显示，禁用
        this.themeSwitchLocked = true
        const chosen = family.find((t) => t.variantKey === variant)
        if (chosen && (chosen.variant === 'light' || chosen.variant === 'dark')) lock = chosen.variant
      } else {
        this.themeSwitchLocked = hasLight && hasDark ? false : true
      }
      this.themeLock = lock
      // 锁定只改内存生效值、不落盘：持久化的 theme 仍是用户偏好，
      // 解除锁定时（换内置/多变体主题）自然恢复，不会被锁定期的写盘覆盖
      const target = lock ?? (await window.api.app.getConfig()).theme
      if (this.themePref !== target) {
        this.themePref = target
        this.applyTheme()
      }
    },
    /** 解除锁定：回到配置里持久化的明暗偏好 */
    async applyPersistedThemePref(): Promise<void> {
      const cfg = await window.api.app.getConfig()
      if (this.themePref !== cfg.theme) {
        this.themePref = cfg.theme
        this.applyTheme()
      }
    },
    /** 纸面宽度（窗口私有，不广播）：立即生效并按窗口键持久化 */
    async setPageWidth(pageWidthPct: number): Promise<void> {
      this.winPrefs.pageWidthPct = Math.min(100, Math.max(this.pageWidthMinPct, Math.round(pageWidthPct)))
      this.applyEditorPrefs()
      await window.api.app.setWindowPrefs(useDocumentsStore().windowKey, {
        pageWidthPct: this.winPrefs.pageWidthPct
      })
    },
    async setAutosave(patch: Partial<AppConfig['autosave']>): Promise<void> {
      if (patch.enabled !== undefined) this.autosaveEnabled = patch.enabled
      if (patch.intervalMs !== undefined) {
        this.autosaveIntervalMs = Math.max(3000, patch.intervalMs)
      }
      if (patch.silent !== undefined) this.autosaveSilent = patch.silent
      await window.api.app.setConfig({
        autosave: {
          enabled: this.autosaveEnabled,
          intervalMs: this.autosaveIntervalMs,
          silent: this.autosaveSilent
        }
      })
    },
    async setRestoreTabs(v: boolean): Promise<void> {
      this.restoreTabs = v
      await window.api.app.setConfig({ restoreTabs: v })
    },
    async setRestoreFolders(v: boolean): Promise<void> {
      this.restoreFolders = v
      await window.api.app.setConfig({ restoreFolders: v })
    },
    /** 工作区文件树仅显示可打开的文档类型（全局偏好，跨窗口同步） */
    async setWsOpenableOnly(v: boolean): Promise<void> {
      this.wsOpenableOnly = v
      await window.api.app.setConfig({ wsOpenableOnly: v })
    },
    async setOpenAtLogin(v: boolean): Promise<void> {
      this.openAtLogin = v
      await window.api.app.setConfig({ openAtLogin: v })
    },
  async setCloseAction(v: 'quit' | 'tray'): Promise<void> {
    this.closeAction = v
    await window.api.app.setConfig({ closeAction: v })
  },
  /** 应用级快捷键覆盖（改键/清除/恢复默认）：持久化后主进程重建菜单并广播各窗口跟随 */
  async setShortcuts(next: ShortcutOverrides): Promise<void> {
    this.shortcuts = { ...next }
    await window.api.app.setConfig({ shortcuts: next })
  },
  /** 图床上传偏好（全局，跨窗口同步）；必须展开成普通对象过 IPC（reactive Proxy 静默失败） */
  async setUpload(patch: Partial<AppConfig['upload']>): Promise<void> {
    this.upload = { ...this.upload, ...patch }
    await window.api.app.setConfig({ upload: { ...this.upload } })
  },
  /** Vim 模式开关（全局，跨窗口同步） */
  async setVimMode(v: boolean): Promise<void> {
    this.vimMode = v
    await window.api.app.setConfig({ vimMode: v })
  },
  /* ---------- 插件（6.9） ---------- */
  upsertPluginCommand(cmd: PluginCommand): void {
    const i = this.pluginCommands.findIndex((c) => c.id === cmd.id)
    if (i >= 0) this.pluginCommands.splice(i, 1, cmd)
    else this.pluginCommands.push(cmd)
  },
  removePluginCommand(id: string): void {
    const i = this.pluginCommands.findIndex((c) => c.id === id)
    if (i >= 0) this.pluginCommands.splice(i, 1)
  },
  /** 启用/禁用插件：持久化后广播（各窗口 applyConfig → syncPlugins 重装载）。
   *  disabled 数组必须展开成普通数组过 IPC（reactive Proxy 静默克隆失败） */
  async setPluginEnabled(id: string, on: boolean): Promise<void> {
    const set = new Set(this.pluginsDisabled)
    if (on) set.delete(id)
    else set.add(id)
    this.pluginsDisabled = [...set]
    await window.api.app.setConfig({ plugins: { disabled: [...this.pluginsDisabled] } })
  },
  /** 设置页「重新加载」：重扫目录 + 重装载全部插件（新增/改码后无需重启应用） */
  async reloadPlugins(): Promise<void> {
    const { syncPlugins } = await import('@/services/pluginHost')
    await syncPlugins()
  },
  /** 设置页「打开插件目录」 */
  async openPluginsDir(): Promise<void> {
    await window.api.plugin.openDir()
  },
    async setThemePref(pref: ThemePref): Promise<void> {
      // 主题决定了明暗（单变体或固定变体）时忽略切换（按钮已禁用，此处兜底菜单/插件调用）
      if ((this.themeLock || this.themeSwitchLocked) && pref !== this.themePref) return
      this.themePref = pref
      this.applyTheme()
      await window.api.app.setConfig({ theme: pref })
    },
    /** 切换语言：持久化 + 渲染层词典与主进程（菜单/托盘）同步 */
    async setLocalePref(pref: LocalePref): Promise<void> {
      this.localePref = pref
      i18n.global.locale.value = resolveLocale(pref)
      await window.api.app.setConfig({ locale: pref })
      await window.api.app.setLocale(pref)
    },
    applyTheme(): void {
      this.effectiveTheme =
        this.themePref === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : this.themePref
      document.documentElement.dataset.theme = this.effectiveTheme
      // 主题族按明暗自动换变体（xxx / xxx-dark）：明暗切换后重新解析并注入
      const appearance = { ...this.appearance }
      void import('@/services/appearance').then((m) => m.applyAppearanceConfig({ appearance }))
    },
    async toggleTheme(): Promise<void> {
      if (this.themeLock || this.themeSwitchLocked) return // 明暗由当前主题/变体决定
      // system 时切入当前解析结果的反面；之后 light ⇄ dark 往返
      this.themePref = this.effectiveTheme === 'dark' ? 'light' : 'dark'
      this.applyTheme()
      await window.api.app.setConfig({ theme: this.themePref })
    },
    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen
      this.updatePageWidthMin() // 可用宽度变化，滑杆最小值随之更新
    },
    setSidebarMode(mode: SidebarMode): void {
      this.sidebarMode = mode
      this.sidebarOpen = true
    },
    /** 菜单/快捷键入口：切到搜索模式（已在该模式且侧栏展开时 = 折叠） */
    toggleSearchPanel(): void {
      if (this.sidebarOpen && this.sidebarMode === 'search') this.toggleSidebar()
      else this.setSidebarMode('search')
    },
    requestFind(): void {
      this.findRequest++
    },
    jumpTo(line: number): void {
      // 目标行同步进视口行号：点击立即高亮大纲对应项；
      // 同时锁住滚动驱动的更新——平滑动画期间的 scroll 事件
      // 会从旧章节开始逐段上报，会把高亮拽回去
      this.viewLine = Math.max(1, line)
      this.viewLineLockUntil = Date.now() + 700
      this.jumpLine = { line, seq: (this.jumpLine?.seq ?? 0) + 1 }
    },
    openSettings(): void {
      this.settingsOpen = true
    },
    openExport(): void {
      this.exportOpen = true
    },
    /** 外部修改已写回 store：通知挂载中的编辑器整档重新同步 */
    notifyReload(): void {
      this.extReloadSeq++
    },
    toggleShortcutPanel(): void {
      this.shortcutPanelOpen = !this.shortcutPanelOpen
    },
    /** Quick Open：Ctrl+P 呼出/关闭（Esc 由组件自行处理） */
    toggleQuickOpen(): void {
      this.quickOpenOpen = !this.quickOpenOpen
    },
    /** 轻提示：显示 3 秒后自动消失 */
    showToast(message: string): void {
      this.toast = message
      window.clearTimeout(this._toastTimer)
      this._toastTimer = window.setTimeout(() => (this.toast = ''), 3000)
    },
    /** 自绘确认框（替代原生 window.confirm）；resolve(true) = 确认 */
    askConfirm(
      title: string,
      message: string,
      opts?: { okText?: string; cancelText?: string; danger?: boolean }
    ): Promise<boolean> {
      return new Promise((resolve) => {
        this.confirm = {
          title,
          message,
          okText: opts?.okText ?? t('common.ok'),
          cancelText: opts?.cancelText ?? t('common.cancel'),
          danger: opts?.danger ?? false,
          resolve
        }
      })
    },
    resolveConfirm(ok: boolean): void {
      this.confirm?.resolve(ok)
      this.confirm = null
    },
    /** 多选弹框：choices 按显示顺序（左→右），Esc 解析为 value 为 'cancel' 的项 */
    askChoice(
      title: string,
      message: string,
      choices: { text: string; value: string; danger?: boolean }[]
    ): Promise<string> {
      return new Promise((resolve) => {
        this.choice = { title, message, choices, resolve }
      })
    },
    resolveChoice(value: string): void {
      this.choice?.resolve(value)
      this.choice = null
    },
    toggleFocus(): void {
      this.focusMode = !this.focusMode
      this.showToast(this.focusMode ? t('ui.focusOn') : t('ui.focusOff'))
    },
    toggleTypewriter(): void {
      this.typewriterMode = !this.typewriterMode
      this.showToast(this.typewriterMode ? t('ui.typewriterOn') : t('ui.typewriterOff'))
    },
    /** 禅模式：隐藏标签栏/状态栏/墨脊与侧栏，退出时恢复侧栏；
     *  快捷键面板不强制关闭——它是随叫随到的参考层，Ctrl+/ 在禅模式下同样可开 */
    toggleZen(): void {
      if (!this.zenMode) {
        this._zenPrevSidebar = this.sidebarOpen
        this.sidebarOpen = false
      } else {
        this.sidebarOpen = this._zenPrevSidebar
      }
      this.zenMode = !this.zenMode
      this.showToast(this.zenMode ? t('ui.zenOn') : t('ui.zenOff'))
    },
    setEditorMode(mode: EditorMode): void {
      this.editorMode = mode
      // 模式随标签记忆：写进活动标签，切标签/重启会话时跟随恢复
      const tab = useDocumentsStore().active
      if (tab && !tab.isHome) tab.mode = mode
      this.applyEditorPrefs() // 双栏/单栏的纸宽策略不同
    }
  }
})
