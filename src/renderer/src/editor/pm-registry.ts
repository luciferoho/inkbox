import type { EditorView } from '@milkdown/kit/prose/view'

/** 活跃即显(ProseMirror)视图登记表：编辑器实例由图片插件注册，
    图片右键上传等文档级操作从这里拿视图做原地替换（不整档重载、不丢滚动） */
const views = new Set<EditorView>()

export function registerPmView(view: EditorView): () => void {
  views.add(view)
  return () => {
    views.delete(view)
  }
}

export function pmViews(): EditorView[] {
  return [...views]
}
