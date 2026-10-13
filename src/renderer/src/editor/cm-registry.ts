import type { EditorView } from '@codemirror/view'

/** 活跃 CodeMirror 视图登记表：源码/双栏的编辑器实例由 SourceEditor 注册，
    图片右键菜单等文档级委托从这里拿视图做坐标→位置换算 */
const views = new Set<EditorView>()

export function registerCmView(view: EditorView): () => void {
  views.add(view)
  return () => {
    views.delete(view)
  }
}

export function cmViews(): EditorView[] {
  return [...views]
}
