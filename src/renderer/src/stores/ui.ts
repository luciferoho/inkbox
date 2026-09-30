import { defineStore } from 'pinia'
import type { AppConfig, WindowPrefs } from '@shared/types'
import { i18n, resolveLocale, t, type LocalePref } from '@/i18n'
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
    focusMode: false,
    typewriterMode: false,
    /** 禅模式：隐藏标签栏/状态栏/侧栏，Esc 或菜单退出 */
    zenMode: false,
    /* 禅模式进入前的侧栏状态，退出时恢复 */
    _zenPrevSidebar: false as boolean,
    autosaveEnabled: true,
    autosaveIntervalMs: 15000,
    /* 再次打开窗口时恢复上次打开的文件标签（默认开） */
    restoreTabs: true,
    /* 再次打开窗口时恢复上次打开的文件夹（默认开） */
    restoreFolders: true,
    /* 点窗口关闭按钮的行为：quit = 退出程序；tray = 最小化到托盘 */
    closeAction: 'quit' as 'quit' | 'tray',
    statusMessage: t('ui.ready'),
    /* 编辑器跨组件请求（计数器/序列号触发 watch） */
    findRequest: 0,
    jumpLine: null as { line: number; seq: number } | null,
    currentLine: 1,
    /* 弹层 */
    settingsOpen: false,
    exportOpen: false,
    viewerImage: null as string | null,
    /* 外部修改重载信号：编辑器 watch 该序号后从 store 重新整档同步 */
    extReloadSeq: 0,
    /* 右侧快捷键面板 */
    shortcutPanelOpen: false,
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
    editorPrefs: { fontSize: 16, lineHeight: 1.7 },
    /* 窗口私有偏好：各窗口尺寸不同，纸宽/侧栏宽独立调整、不同步 */
    winPrefs: { pageWidthPct: 80, sidebarWidth: 264 } as WindowPrefs,
    /* 纸宽滑杆的动态最小值（保证纸面不窄于 620px，随窗口/侧栏状态变化） */
    pageWidthMinPct: 50
  }),
  actions: {
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
      this.restoreTabs = cfg.restoreTabs ?? true
      this.restoreFolders = cfg.restoreFolders ?? true
      this.closeAction = cfg.closeAction ?? 'quit'
      this.editorPrefs = { ...cfg.editor }
      this.applyTheme()
      this.applyEditorPrefs()
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
      this.editorPrefs = { ...this.editorPrefs, ...patch }
      this.applyEditorPrefs()
      await window.api.app.setConfig({ editor: { ...this.editorPrefs } })
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
      await window.api.app.setConfig({
        autosave: { enabled: this.autosaveEnabled, intervalMs: this.autosaveIntervalMs }
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
    async setCloseAction(v: 'quit' | 'tray'): Promise<void> {
      this.closeAction = v
      await window.api.app.setConfig({ closeAction: v })
    },
    async setThemePref(pref: ThemePref): Promise<void> {
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
    },
    async toggleTheme(): Promise<void> {
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
    /** 禅模式：隐藏标签栏/状态栏/侧栏，退出时恢复侧栏 */
    toggleZen(): void {
      if (!this.zenMode) {
        this._zenPrevSidebar = this.sidebarOpen
        this.sidebarOpen = false
        this.shortcutPanelOpen = false
      } else {
        this.sidebarOpen = this._zenPrevSidebar
      }
      this.zenMode = !this.zenMode
      this.showToast(this.zenMode ? t('ui.zenOn') : t('ui.zenOff'))
    },
    setEditorMode(mode: EditorMode): void {
      this.editorMode = mode
      this.applyEditorPrefs() // 双栏/单栏的纸宽策略不同
    }
  }
})
