import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import { useWorkspaceStore } from './workspace'
import type { DetachDoc, DraftPayload } from '@shared/types'
import { t } from '@/i18n'
import { htmlToMarkdown } from '@/services/richPaste'
import sampleDoc from '@samples/示例.md?raw'

/** 主页（欢迎页）标签的固定 id */
export const HOME_ID = 0

export interface DocTab {
  id: number
  path: string | null
  name: string
  content: string
  dirty: boolean
  /** 主页标签：不可关闭/不可拖拽/不参与保存 */
  isHome?: boolean
  /** 最近一次由本应用成功写盘的内容快照。外部修改检测用：磁盘内容与它一致
   *  即为自身保存的回声（自动保存后 300ms 内继续输入也不误报）。null = 从未写过 */
  savedContent?: string | null
}

function makeHomeTab(): DocTab {
  return { id: HOME_ID, path: null, name: t('docs.home'), content: '', dirty: false, isHome: true }
}

let nextId = 1

/** 草稿防抖定时器（模块级：多实例共享一个写入节奏） */
let draftFlushTimer: number | undefined

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

/** 多标签文档集合。主页标签常驻首位。 */
export const useDocumentsStore = defineStore('documents', {
  state: () => ({
    tabs: [makeHomeTab()] as DocTab[],
    activeId: HOME_ID as number | null,
    /** 窗口键（主进程分配，w1/w2…）：草稿文件按窗口隔离，重启后首个窗口接管历史草稿 */
    windowKey: 'w1',
    /** 关闭确认后的护栏：冻结内容变更与草稿写入，防止编辑器异步回推弄脏已保存状态 */
    closing: false
  }),
  getters: {
    active(state): DocTab | null {
      return state.tabs.find((t) => t.id === state.activeId) ?? null
    }
  },
  actions: {
    setWindowKey(key: string): void {
      this.windowKey = key
    },

    /** 草稿存储键：窗口键 + 标签 id（跨窗口不冲突） */
    draftKey(id: number): string {
      return `${this.windowKey}-${id}`
    },

    /** 会话快照：本窗口当前打开的文件标签与工作区文件夹（sessions/<窗口键>.json） */
    persistSession(): void {
      this.persistSessionNow().catch(() => undefined)
    },

    /** 可等待版本：关窗确认流程在销毁窗口前必须等会话真正落盘 */
    async persistSessionNow(): Promise<void> {
      const ws = useWorkspaceStore()
      const tabs = this.tabs.filter((t) => t.path).map((t) => t.path as string)
      const active = this.active?.path ?? null
      await window.api.session.save(this.windowKey, { tabs, active, folder: ws.root })
    },

    /**
     * 立即把未保存/未落盘文档写入草稿。调用时机：停止输入 800ms 后（防抖）、
     * 5 秒兜底 tick、窗口失焦、关窗确认流程——保证退出时草稿即最新内容
     */
    flushDrafts(): void {
      if (this.closing) return
      window.clearTimeout(draftFlushTimer)
      for (const tab of this.tabs) {
        if (tab.isHome) continue
        if (tab.dirty || tab.path === null) {
          window.api.drafts
            .save(this.draftKey(tab.id), {
              path: tab.path,
              name: tab.name,
              content: tab.content,
              ts: Date.now()
            })
            .catch((err) => console.error('[drafts] save failed:', err))
        }
      }
    },

    /** 编辑后防抖写草稿（在 updateContent 里触发） */
    scheduleDraftFlush(): void {
      window.clearTimeout(draftFlushTimer)
      draftFlushTimer = window.setTimeout(() => this.flushDrafts(), 800)
    },
    newDoc(): void {
      const n = this.tabs.filter((t) => t.path === null && !t.isHome).length + 1
      const tab: DocTab = {
        id: nextId++,
        path: null,
        name: t('docs.untitled', { n }),
        content: '',
        dirty: false
      }
      this.tabs.push(tab)
      this.activeId = tab.id
    },

    /** 激活主页（欢迎页）标签 */
    activateHome(): void {
      this.activeId = HOME_ID
    },

    /** 打开内置功能示例（samples/示例.md，随构建打包，只读起点，可另存） */
    openSample(): void {
      const existing = this.tabs.find((t) => t.name === '示例.md' && t.path === null)
      if (existing) {
        this.activeId = existing.id
        return
      }
      const tab: DocTab = {
        id: nextId++,
        path: null,
        name: '示例.md',
        content: sampleDoc,
        dirty: false
      }
      this.tabs.push(tab)
      this.activeId = tab.id
    },

    async openFile(): Promise<void> {
      const path = await window.api.dialog.openFile()
      if (path) await this.openPath(path)
    },

  /**
   * 打开路径：.md/.txt 直接开标签；.html/.htm 读入后 turndown 转
   * Markdown，生成未落盘的新草稿（另存才落盘）
   */
  async openPath(path: string): Promise<void> {
    if (/\.(html?|xhtml)$/i.test(path)) {
      await this.importHtml(path)
      return
    }
    const existing = this.tabs.find((t) => t.path === path)
      if (existing) {
        this.activeId = existing.id
        return
      }
      // 跨窗口去重：文件已在别的窗口打开 → 激活那边，本窗口不开
      if ((await window.api.doc.tryOpen(path)) !== 'ok') {
        useUiStore().showToast(t('docs.openedElsewhere', { name: basename(path) }))
        return
      }
      try {
        const content = await window.api.fs.readFile(path)
        const tab: DocTab = {
          id: nextId++,
          path,
          name: basename(path),
          content,
          dirty: false,
          savedContent: content
        }
        this.tabs.push(tab)
        this.activeId = tab.id
        window.api.watch.watch(path)
        const cfg = await window.api.app.getConfig()
        const recent = [
          { path, ts: Date.now() },
          ...cfg.recent.filter((r) => r.path !== path)
        ].slice(0, 10)
        await window.api.app.setConfig({ recent })
        this.persistSession()
      } catch (err) {
        window.api.doc.release(path) // 打开失败：释放独占登记
        useUiStore().showToast(t('docs.openFailed', { path }))
        console.error('[documents] open failed:', err)
      }
    },

    /** 导入 HTML 文件 → Markdown 草稿（turndown + GFM，与富文本粘贴同一转换器） */
    async importHtml(path: string): Promise<void> {
      const ui = useUiStore()
      try {
        const html = await window.api.fs.readFile(path)
        const md = await htmlToMarkdown(html)
        if (md === null) {
          ui.showToast(t('docs.htmlImportEmpty'))
          return
        }
        const base = basename(path).replace(/\.[^.]+$/, '')
        const tab: DocTab = {
          id: nextId++,
          path: null,
          name: `${base}.md`,
          content: md,
          dirty: true
        }
        this.tabs.push(tab)
        this.activeId = tab.id
        ui.showToast(t('docs.htmlImported', { name: `${base}.md` }))
      } catch (err) {
        ui.showToast(t('docs.openFailed', { path }))
        console.error('[documents] html import failed:', err)
      }
    },

    async save(saveAs = false): Promise<void> {
      const tab = this.active
      if (tab) await this.saveTab(tab, saveAs)
    },

    /** 保存指定标签（关窗"保存并退出"逐个保存用） */
    async saveTab(tab: DocTab, saveAs = false): Promise<void> {
      let path = tab.path
      if (saveAs || path === null) {
        path = await window.api.dialog.saveFile(tab.name)
        if (!path) return
      }
      const prevPath = tab.path
      try {
        // 先取写盘的确切内容：await 期间用户可能继续输入，写完再读 tab.content
        // 会把「没写进磁盘的新内容」记成快照，外部修改检测就认不出自身保存的回声
        const written = tab.content
        await window.api.fs.writeFile(path, written)
        tab.path = path
        tab.name = basename(path)
        tab.dirty = false
        tab.savedContent = written // 记录写盘快照：外部修改检测凭它识别自身保存的回声
        // 另存 = 换了被监听文件；备份已落盘，清掉
        if (prevPath && prevPath !== path) {
          window.api.watch.unwatch(prevPath)
          window.api.doc.release(prevPath)
        }
        window.api.watch.watch(path)
        window.api.doc.acquire(path)
        void window.api.drafts.clear(this.draftKey(tab.id))
        const ui = useUiStore()
        ui.saveState = 'saved'
        ui.savedAt = Date.now()
        ui.showToast(t('docs.saved', { name: tab.name }))
        // 保存 = 最近编辑，写入最近文件（新保存的文档也能出现在列表里）
        const cfg = await window.api.app.getConfig()
        const recent = [
          { path, ts: Date.now() },
          ...cfg.recent.filter((r) => r.path !== path)
        ].slice(0, 10)
        await window.api.app.setConfig({ recent })
        this.persistSession()
      } catch (err) {
        useUiStore().showToast(t('docs.saveFailed', { name: tab.name }))
        console.error('[documents] save failed:', err)
      }
    },

    closeActive(): void {
      const tab = this.active
      if (!tab) return
      void this.closeIfClean(tab)
    },

    /** 带脏检查的关闭：有未保存修改时弹自绘确认框；返回是否真的关闭 */
    async closeIfClean(tab: DocTab): Promise<boolean> {
      if (tab.isHome) return false
      if (tab.dirty) {
        const ok = await useUiStore().askConfirm(t('docs.closeDirtyTitle'), t('docs.closeDirtyMsg', { name: tab.name }), {
          okText: t('docs.discardClose'),
          danger: true
        })
        if (!ok) return false
      }
      this.closeTab(tab.id)
      return true
    },

    async closeOthers(id: number): Promise<void> {
      if (id === HOME_ID) id = this.tabs.find((t) => !t.isHome)?.id ?? HOME_ID
      const anchor = this.tabs.findIndex((t) => t.id === id)
      if (anchor < 0) return
      for (const tab of [...this.tabs.slice(0, anchor), ...this.tabs.slice(anchor + 1)]) {
        if (!(await this.closeIfClean(tab))) continue
      }
    },

    async closeToLeft(id: number): Promise<void> {
      const anchor = this.tabs.findIndex((t) => t.id === id)
      if (anchor < 0) return
      for (const tab of [...this.tabs.slice(0, anchor)]) {
        await this.closeIfClean(tab)
      }
    },

    async closeToRight(id: number): Promise<void> {
      const anchor = this.tabs.findIndex((t) => t.id === id)
      if (anchor < 0) return
      for (const tab of [...this.tabs.slice(anchor + 1)]) {
        await this.closeIfClean(tab)
      }
    },

    async closeAllTabs(): Promise<void> {
      for (const tab of [...this.tabs]) {
        await this.closeIfClean(tab)
      }
    },

    /** 拖拽排序：把 id 标签插入到原数组的 targetIndex 位置（可为 length = 拖到最后）；
     *  主页常驻首位，任何标签都不能插到它前面 */
    moveTab(id: number, targetIndex: number): void {
      const from = this.tabs.findIndex((t) => t.id === id)
      if (from < 0 || this.tabs[from].isHome) return
      const [tab] = this.tabs.splice(from, 1)
      const adjusted = targetIndex > from ? targetIndex - 1 : targetIndex
      this.tabs.splice(Math.max(1, Math.min(this.tabs.length, adjusted)), 0, tab)
    },

    closeTab(id: number): void {
      if (id === HOME_ID) return // 主页不可关闭
      const i = this.tabs.findIndex((t) => t.id === id)
      if (i < 0) return
      const [tab] = this.tabs.splice(i, 1)
      if (tab.path) {
        window.api.watch.unwatch(tab.path)
        window.api.doc.release(tab.path)
      }
      void window.api.drafts.clear(this.draftKey(id))
      if (this.activeId === id) {
        // 关掉最后一个真实标签时回落到主页
        this.activeId = this.tabs[Math.min(i, this.tabs.length - 1)]?.id ?? HOME_ID
      }
      this.persistSession()
    },

    /** 编辑器内容变更（来自 CodeMirror/Milkdown updateListener） */
    updateContent(id: number, content: string): void {
      if (this.closing) return // 关闭确认后编辑器可能异步回推一次旧序列化，忽略
      const tab = this.tabs.find((t) => t.id === id)
      if (tab && !tab.isHome && tab.content !== content) {
        tab.content = content
        tab.dirty = true
        useUiStore().saveState = 'dirty'
        this.scheduleDraftFlush() // 停止输入 800ms 后草稿即最新（修"退出后草稿不是最新"）
      }
    },

    activate(id: number): void {
      this.activeId = id
      // 切换标签时同步保存状态：脏 → 未保存；否则清空（"已保存 HH:mm" 只属于刚保存的那次）
      const tab = this.tabs.find((t) => t.id === id)
      useUiStore().saveState = tab && !tab.isHome && tab.dirty ? 'dirty' : 'clean'
      this.persistSession()
    },

    /** 外部修改（fs:fileChanged）：内容比对后决定静默重载 / 询问 / 忽略自身保存 */
    async handleExternalChange(path: string): Promise<void> {
      const tab = this.tabs.find((t) => t.path === path)
      if (!tab) return
      const ui = useUiStore()
      let disk: string
      try {
        disk = await window.api.fs.readFile(path)
      } catch {
        ui.showToast(t('docs.fileGone', { name: tab.name }))
        return
      }
      if (disk === tab.content) return // 内容一致（外部改成相同内容或无实质变化）
      // 自身保存的回声：磁盘仍是上次写盘的内容，编辑器里的更新是保存后继续输入
      if (tab.savedContent !== null && tab.savedContent !== undefined && disk === tab.savedContent) {
        return
      }
      if (!tab.dirty) {
        tab.content = disk
        tab.savedContent = disk
        tab.dirty = false
        ui.notifyReload()
        ui.showToast(t('docs.reloaded', { name: tab.name }))
        return
      }
      const ok = await ui.askConfirm(
        t('docs.extTitle'),
        t('docs.extMsg', { name: tab.name }),
        { okText: t('docs.reload'), danger: true }
      )
      if (ok) {
        tab.content = disk
        tab.savedContent = disk
        tab.dirty = false
        ui.notifyReload()
        ui.showToast(t('docs.reloaded', { name: tab.name }))
      }
    },

    /** 启动时恢复备份的未保存文档（仅异常退出后调用；正常启动清空不恢复） */
    restoreDrafts(list: DraftPayload[]): void {
      let last = -1
      for (const d of list) {
        if (d.path && this.tabs.some((t) => t.path === d.path)) continue // 同文件已打开
        const tab: DocTab = {
          id: nextId++,
          path: d.path,
          name: d.name,
          content: d.content,
          dirty: true
        }
        this.tabs.push(tab)
        last = tab.id
        if (d.path) {
          window.api.watch.watch(d.path)
          window.api.doc.acquire(d.path)
        }
      }
      if (last >= 0) {
        this.activeId = last
        useUiStore().showToast(t('docs.draftsRestoredN', { n: list.length }))
      }
    },

    /** 拖出标签的新窗口启动：直接把转移来的文档开成标签 */
    restoreDetached(doc: DetachDoc): void {
      const tab: DocTab = {
        id: nextId++,
        path: doc.path,
        name: doc.name,
        content: doc.content,
        dirty: doc.dirty
      }
      this.tabs.push(tab)
      this.activeId = tab.id
      if (doc.path) {
        window.api.watch.watch(doc.path)
        window.api.doc.acquire(doc.path)
      }
      this.persistSession()
    },

    /** 跨窗口拖入：把别的窗口拖来的标签接到本窗口（index 为空 = 追加到最后）。
     *  同文件已在本窗口时更新其内容并激活（拖动编辑版优先），不再开重复标签 */
    adoptDoc(doc: DetachDoc, index: number | null): void {
      const existing = doc.path ? this.tabs.find((t) => t.path === doc.path) : undefined
      if (existing) {
        if (existing.content !== doc.content) {
          existing.content = doc.content
          existing.dirty = existing.dirty || doc.dirty
          useUiStore().notifyReload()
        }
        this.activate(existing.id)
        return
      }
      const tab: DocTab = {
        id: nextId++,
        path: doc.path,
        name: doc.name,
        content: doc.content,
        dirty: doc.dirty
      }
      const at = index === null ? this.tabs.length : Math.min(Math.max(1, index), this.tabs.length)
      this.tabs.splice(at, 0, tab)
      this.activeId = tab.id
      if (doc.path) {
        window.api.watch.watch(doc.path)
        window.api.doc.acquire(doc.path)
      }
      this.persistSession()
    },

    /** 其他窗口请求激活本窗口中该文件的标签（跨窗口去重） */
    activateByPath(path: string): void {
      const tab = this.tabs.find((t) => t.path === path)
      if (tab) this.activate(tab.id)
    },

    /** 上一/下一标签（Ctrl+Shift+Tab / Ctrl+Tab），按标签栏顺序循环 */
    cycleTab(delta: 1 | -1): void {
      const real = this.tabs.filter((t) => !t.isHome)
      if (real.length === 0) return
      const i = real.findIndex((t) => t.id === this.activeId)
      const next = real[(i + delta + real.length) % real.length]
      this.activate(next.id)
    },

    /**
     * 启动恢复上次会话（仅首窗口；多窗口的标签与文件夹并入本窗口）。
     * - 崩溃恢复（crashed=true）：无视系统设置，全部恢复——未保存内容已在草稿里
     * - 正常启动：文件标签/文件夹分别跟随 恢复标签/恢复文件夹 设置
     * 有未保存草稿的文件跳过——草稿已先行恢复，避免磁盘版盖掉未保存修改
     */
    async restoreSession(opts: {
      restoreTabs: boolean
      restoreFolders: boolean
      crashed: boolean
    }): Promise<void> {
      if (this.windowKey !== 'w1') return
      try {
        const entries = await window.api.session.load()
        if (entries.length === 0) return
        const restoreFiles = opts.crashed || opts.restoreTabs
        const restoreFolder = opts.crashed || opts.restoreFolders
        const draftPaths = new Set(
          (await window.api.drafts.list()).map((e) => e.draft.path).filter((p): p is string => !!p)
        )
        const ordered = [...entries].sort((a, b) => a.key.localeCompare(b.key))
        const firstActive = ordered[0]?.session.active ?? null
        const folder = ordered.map((e) => e.session.folder).find((f): f is string => !!f)
        if (restoreFolder && folder) await useWorkspaceStore().restoreFolder(folder)
        if (restoreFiles) {
          for (const { session } of ordered) {
            for (const p of session.tabs) {
              if (draftPaths.has(p)) continue
              if (this.tabs.some((t) => t.path === p)) continue
              await this.openPath(p)
            }
          }
          const activeTab = firstActive ? this.tabs.find((t) => t.path === firstActive) : null
          if (activeTab) this.activate(activeTab.id)
        }
        await window.api.session.clearOthers(this.windowKey)
      } catch (err) {
        console.error('[documents] session restore failed:', err)
      }
    }
  }
})
