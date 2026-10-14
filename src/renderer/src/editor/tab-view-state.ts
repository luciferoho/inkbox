/**
 * 每标签×每窗格的视图状态（内存级，不持久化）：切换标签时保留上次各窗格的
 * 「内容锚点」而非像素——图片加载会撑高上方内容，像素恢复必然漂移（锚点恢复
 * 后位置随布局收敛，内容始终对得上）。回到该标签时各自恢复；新开标签无记录，
 * 默认回到顶部/文档开头。
 * - source：anchor = 视口顶行的文档位置（CM 高度图文本行高精确），cursor = 光标 head
 * - preview：anchor = 视口顶块的行号（可带小数），图片加载后由 onImgLoad 按它重对齐
 * - wysiwyg：scroll/scrollHeight 记比例（PM 无虚拟化，浏览器 scroll anchoring 兜底）
 */
export interface PaneViewState {
  anchor?: number
  cursor?: number
  scroll?: number
  scrollHeight?: number
}

export type PaneKind = 'source' | 'wysiwyg' | 'preview'

const map = new Map<number, Partial<Record<PaneKind, PaneViewState>>>()

/** 只写本窗格的分键，不整体覆盖（双栏下源码与预览的 watch 都会在切签时保存） */
export function saveTabView(id: number | null, pane: PaneKind, state: PaneViewState): void {
  if (id === null) return
  const entry = map.get(id) ?? {}
  entry[pane] = state
  map.set(id, entry)
}

export function loadTabView(id: number | null, pane: PaneKind): PaneViewState | undefined {
  if (id === null) return undefined
  return map.get(id)?.[pane]
}
