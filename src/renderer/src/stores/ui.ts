import { defineStore } from 'pinia'
import type { AppConfig } from '@shared/types'

export type ThemePref = 'light' | 'dark' | 'system'
export type SidebarMode = 'outline' | 'files'
export type EditorMode = 'wysiwyg' | 'edit' | 'split' | 'preview'

/** 界面状态：主题 / 侧栏 / 编辑模式 / 窗口态 / 状态栏消息 / 跨组件请求 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    themePref: 'system' as ThemePref,
    effectiveTheme: 'light' as 'light' | 'dark',
    sidebarOpen: true,
    sidebarMode: 'outline' as SidebarMode,
    editorMode: 'split' as EditorMode,
    maximized: false,
    focusMode: false,
    typewriterMode: false,
    autosaveEnabled: true,
    autosaveIntervalMs: 15000,
    statusMessage: '就绪',
    /* 编辑器跨组件请求（计数器/序列号触发 watch） */
    findRequest: 0,
    jumpLine: null as { line: number; seq: number } | null,
    currentLine: 1,
    /* 弹层 */
    settingsOpen: false,
    viewerImage: null as string | null,
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
    /* 排版偏好（镜像 AppConfig.editor，实时生效；纸宽为可用宽度百分比） */
    editorPrefs: { fontSize: 16, lineHeight: 1.7, pageWidthPct: 80 },
    /* 纸宽滑杆的动态最小值（保证纸面不窄于 620px，随窗口/侧栏状态变化） */
    pageWidthMinPct: 50,
    /* 侧栏宽度（可拖拽调整，持久化） */
    sidebarWidth: 264
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
      this.autosaveEnabled = cfg.autosave.enabled
      this.autosaveIntervalMs = Math.max(3000, cfg.autosave.intervalMs)
      this.editorPrefs = { ...cfg.editor }
      this.sidebarWidth = Math.min(440, Math.max(200, cfg.sidebarWidth ?? 264))
      this.applyTheme()
      this.applyEditorPrefs()
      this.applySidebarWidth()
    },
    applySidebarWidth(): void {
      document.documentElement.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`)
    },
    /** 拖拽过程实时调宽（不落盘） */
    resizeSidebarLive(width: number): void {
      this.sidebarWidth = Math.min(440, Math.max(200, Math.round(width)))
      this.applySidebarWidth()
      this.updatePageWidthMin()
    },
    async persistSidebarWidth(): Promise<void> {
      await window.api.app.setConfig({ sidebarWidth: this.sidebarWidth })
    },
    /** 排版偏好 → CSS 变量。纸宽为可用宽度百分比（100% = 占满可用宽度，只留四周间距） */
    applyEditorPrefs(): void {
      const { fontSize, lineHeight, pageWidthPct } = this.editorPrefs
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
      const panel = this.sidebarOpen ? this.sidebarWidth : 0
      const pad = 50 // paper-scroll 左右留白 + 纸卡边框
      const available = Math.max(320, window.innerWidth - rail - panel - pad)
      this.pageWidthMinPct = Math.min(90, Math.max(40, Math.ceil((620 / available) * 100)))
    },
    async setEditorPrefs(patch: Partial<AppConfig['editor']>): Promise<void> {
      this.editorPrefs = { ...this.editorPrefs, ...patch }
      this.applyEditorPrefs()
      await window.api.app.setConfig({ editor: this.editorPrefs })
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
    async setThemePref(pref: ThemePref): Promise<void> {
      this.themePref = pref
      this.applyTheme()
      await window.api.app.setConfig({ theme: pref })
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
    requestFind(): void {
      this.findRequest++
    },
    jumpTo(line: number): void {
      this.jumpLine = { line, seq: (this.jumpLine?.seq ?? 0) + 1 }
    },
    openSettings(): void {
      this.settingsOpen = true
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
          okText: opts?.okText ?? '确定',
          cancelText: opts?.cancelText ?? '取消',
          danger: opts?.danger ?? false,
          resolve
        }
      })
    },
    resolveConfirm(ok: boolean): void {
      this.confirm?.resolve(ok)
      this.confirm = null
    },
    toggleFocus(): void {
      this.focusMode = !this.focusMode
      this.showToast(this.focusMode ? '专注模式已开启（F8 关闭）' : '专注模式已关闭')
    },
    toggleTypewriter(): void {
      this.typewriterMode = !this.typewriterMode
      this.showToast(
        this.typewriterMode ? '打字机模式已开启（F9 关闭）' : '打字机模式已关闭'
      )
    },
    setEditorMode(mode: EditorMode): void {
      this.editorMode = mode
      this.applyEditorPrefs() // 双栏/单栏的纸宽策略不同
    }
  }
})
