/**
 * 每标签×每窗格的视图状态（内存级，不持久化）：切换标签时保留上次各窗格的
 * 滚动位置（源码/即显/预览是三个独立滚动容器，双栏下同时可见、各自滚动），
 * 回到该标签时各自原样恢复；新开标签无记录，默认回到顶部/文档开头。
 * 源码窗格额外记录光标 head（查找 x/x 的活动项由它推导）。
 */
export interface PaneViewState {
  scroll: number
  cursor?: number
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
