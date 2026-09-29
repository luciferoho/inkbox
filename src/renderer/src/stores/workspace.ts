import { defineStore } from 'pinia'
import type { DirEntry } from '@shared/types'
import { useUiStore } from './ui'
import { useDocumentsStore } from './documents'

export interface TreeDraft {
  mode: 'new-file' | 'new-dir' | 'rename'
  /** 新建时为目标父目录；重命名时为条目所在目录 */
  parentPath: string
  /** 重命名时的原条目 */
  targetPath?: string
  value: string
}

/** 工作区（打开的文件夹）、懒加载目录树与增删改草稿 */
export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    root: null as string | null,
    children: {} as Record<string, DirEntry[]>,
    expanded: {} as Record<string, boolean>,
    draft: null as TreeDraft | null
  }),
  actions: {
    async openFolder(): Promise<void> {
      const root = await window.api.dialog.openFolder()
      if (!root) return
      this.root = root
      this.children = {}
      this.expanded = { [root]: true }
      await this.loadDir(root)
      useUiStore().setSidebarMode('files')
      useDocumentsStore().persistSession() // 打开的文件夹写入会话快照（重启恢复）
    },

    /** 关闭工作区：清空文件树（已打开的标签保留），文件夹记录从会话快照移除 */
    closeFolder(): void {
      this.root = null
      this.children = {}
      this.expanded = {}
      this.draft = null
      useDocumentsStore().persistSession()
    },

    /** 启动恢复上次打开的工作区文件夹（会话快照） */
    async restoreFolder(path: string): Promise<void> {
      if (!path || this.root === path) return
      try {
        await window.api.fs.readDir(path) // 探测文件夹仍存在，不存在则不恢复
      } catch {
        return
      }
      this.root = path
      this.children = {}
      this.expanded = { [path]: true }
      await this.loadDir(path)
      useUiStore().setSidebarMode('files')
      useDocumentsStore().persistSession()
    },

    async loadDir(path: string): Promise<void> {
      try {
        this.children[path] = await window.api.fs.readDir(path)
      } catch (err) {
        console.error('[workspace] readDir failed:', path, err)
        this.children[path] = []
      }
    },

    async toggle(path: string): Promise<void> {
      this.expanded[path] = !this.expanded[path]
      if (this.expanded[path] && !this.children[path]) await this.loadDir(path)
    },

    /* ---------- 增删改（内联输入草稿） ---------- */

    beginCreate(parentPath: string, isDir: boolean): void {
      this.draft = {
        mode: isDir ? 'new-dir' : 'new-file',
        parentPath,
        value: isDir ? '新建文件夹' : '新建文档.md'
      }
      this.expanded[parentPath] = true
      if (!this.children[parentPath]) void this.loadDir(parentPath)
    },

    beginRename(targetPath: string, currentName: string): void {
      const sepIdx = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'))
      this.draft = {
        mode: 'rename',
        parentPath: sepIdx > 0 ? targetPath.slice(0, sepIdx) : this.root ?? '',
        targetPath,
        value: currentName
      }
    },

    cancelDraft(): void {
      this.draft = null
    },

    async commitDraft(): Promise<void> {
      const d = this.draft
      if (!d) return
      const name = d.value.trim()
      this.draft = null
      if (!name || name === '.' || name === '..') return
      try {
        if (d.mode === 'rename' && d.targetPath) {
          await window.api.fs.rename(d.targetPath, `${d.parentPath}/${name}`)
          // 若重命名的是已打开文档，同步标签路径与跨窗口占用登记
          const docs = useDocumentsStore()
          const tab = docs.tabs.find((t) => t.path === d.targetPath)
          if (tab) {
            tab.path = `${d.parentPath}/${name}`
            tab.name = name
            window.api.doc.release(d.targetPath)
            window.api.doc.acquire(tab.path)
          }
        } else {
          const finalName = d.mode === 'new-file' && !/\.[^.]+$/.test(name) ? `${name}.md` : name
          await window.api.fs.create(`${d.parentPath}/${finalName}`, d.mode === 'new-dir')
        }
        await this.loadDir(d.parentPath)
      } catch (err) {
        console.error('[workspace] commit failed:', err)
        useUiStore().statusMessage = '操作失败（可能已存在同名项）'
        await this.loadDir(d.parentPath)
      }
    },

    async deleteEntry(entry: DirEntry): Promise<void> {
      const hint = entry.isDir ? '文件夹及其全部内容' : entry.name
      const ok = await useUiStore().askConfirm('删除确认', `确定删除${hint}？\n${entry.path}`, {
        okText: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await window.api.fs.delete(entry.path)
        const docs = useDocumentsStore()
        const tab = docs.tabs.find((t) => t.path === entry.path)
        if (tab) docs.closeTab(tab.id)
        const sepIdx = Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\'))
        const parent = sepIdx > 0 ? entry.path.slice(0, sepIdx) : this.root
        if (parent) await this.loadDir(parent)
        useUiStore().showToast('已删除')
      } catch (err) {
        console.error('[workspace] delete failed:', err)
        useUiStore().showToast('删除失败')
      }
    }
  }
})
