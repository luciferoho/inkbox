import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import type { DraftPayload } from '@shared/types'
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
}

function makeHomeTab(): DocTab {
  return { id: HOME_ID, path: null, name: '主页', content: '', dirty: false, isHome: true }
}

let nextId = 1

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

/** 多标签文档集合。主页标签常驻首位。 */
export const useDocumentsStore = defineStore('documents', {
  state: () => ({
    tabs: [makeHomeTab()] as DocTab[],
    activeId: HOME_ID as number | null
  }),
  getters: {
    active(state): DocTab | null {
      return state.tabs.find((t) => t.id === state.activeId) ?? null
    }
  },
  actions: {
    newDoc(): void {
      const n = this.tabs.filter((t) => t.path === null && !t.isHome).length + 1
      const tab: DocTab = {
        id: nextId++,
        path: null,
        name: `未命名-${n}`,
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

    async openPath(path: string): Promise<void> {
      const existing = this.tabs.find((t) => t.path === path)
      if (existing) {
        this.activeId = existing.id
        return
      }
      try {
        const content = await window.api.fs.readFile(path)
        const tab: DocTab = { id: nextId++, path, name: basename(path), content, dirty: false }
        this.tabs.push(tab)
        this.activeId = tab.id
        window.api.watch.watch(path)
        const cfg = await window.api.app.getConfig()
        const recent = [
          { path, ts: Date.now() },
          ...cfg.recent.filter((r) => r.path !== path)
        ].slice(0, 10)
        await window.api.app.setConfig({ recent })
      } catch (err) {
        useUiStore().showToast(`打开失败：${path}`)
        console.error('[documents] open failed:', err)
      }
    },

    async save(saveAs = false): Promise<void> {
      const tab = this.active
      if (!tab) return
      let path = tab.path
      if (saveAs || path === null) {
        path = await window.api.dialog.saveFile(tab.name)
        if (!path) return
      }
      const prevPath = tab.path
      try {
        await window.api.fs.writeFile(path, tab.content)
        tab.path = path
        tab.name = basename(path)
        tab.dirty = false
        // 另存 = 换了被监听文件；草稿已落盘，清掉
        if (prevPath && prevPath !== path) window.api.watch.unwatch(prevPath)
        window.api.watch.watch(path)
        void window.api.drafts.clear(tab.id)
        const ui = useUiStore()
        ui.saveState = 'saved'
        ui.savedAt = Date.now()
        ui.showToast(`已保存 ${tab.name}`)
        // 保存 = 最近编辑，写入最近文件（新保存的文档也能出现在列表里）
        const cfg = await window.api.app.getConfig()
        const recent = [
          { path, ts: Date.now() },
          ...cfg.recent.filter((r) => r.path !== path)
        ].slice(0, 10)
        await window.api.app.setConfig({ recent })
      } catch (err) {
        useUiStore().showToast(`保存失败：${tab.name}`)
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
        const ok = await useUiStore().askConfirm('未保存的修改', `「${tab.name}」有未保存的修改，确定关闭吗？`, {
          okText: '放弃修改并关闭',
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
      if (tab.path) window.api.watch.unwatch(tab.path)
      void window.api.drafts.clear(id)
      if (this.activeId === id) {
        // 关掉最后一个真实标签时回落到主页
        this.activeId = this.tabs[Math.min(i, this.tabs.length - 1)]?.id ?? HOME_ID
      }
    },

    /** 编辑器内容变更（来自 CodeMirror/Milkdown updateListener） */
    updateContent(id: number, content: string): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (tab && !tab.isHome && tab.content !== content) {
        tab.content = content
        tab.dirty = true
        useUiStore().saveState = 'dirty'
      }
    },

    activate(id: number): void {
      this.activeId = id
      // 切换标签时同步保存状态：脏 → 未保存；否则清空（"已保存 HH:mm" 只属于刚保存的那次）
      const tab = this.tabs.find((t) => t.id === id)
      useUiStore().saveState = tab && !tab.isHome && tab.dirty ? 'dirty' : 'clean'
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
        ui.showToast(`文件已被外部删除或移动：${tab.name}`)
        return
      }
      if (disk === tab.content) return // 自身自动保存或无实质变化
      if (!tab.dirty) {
        tab.content = disk
        tab.dirty = false
        ui.notifyReload()
        ui.showToast(`已重新加载外部修改：${tab.name}`)
        return
      }
      const ok = await ui.askConfirm(
        '文件已被外部修改',
        `「${tab.name}」在磁盘上已被其他程序修改。\n重新加载将覆盖当前未保存的修改。`,
        { okText: '重新加载', danger: true }
      )
      if (ok) {
        tab.content = disk
        tab.dirty = false
        ui.notifyReload()
        ui.showToast(`已重新加载外部修改：${tab.name}`)
      }
    },

    /** 启动时恢复草稿（未落盘/有未保存修改的文档） */
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
        if (d.path) window.api.watch.watch(d.path)
      }
      if (last >= 0) {
        this.activeId = last
        useUiStore().showToast('草稿已恢复，请检查后保存')
      }
    }
  }
})
