/**
 * 每标签一份浏览进度（同一文档的所有模式共享，不按模式分开记忆）：
 * - frac：垂直滚动进度 0..1（scrollTop / 可滚动高度）。各模式布局不同，
 *   语义统一为「读到文档大约哪里」——模式切换时各窗格对齐到它，保持同一位置；
 *   切换标签时恢复它（新标签无记录 → 默认顶部）。
 * - cursor：源码光标位置（仅源码编辑器写入/恢复，跨模式保持编辑状态）。
 * 内存级，不持久化。图片加载改变高度期间由各窗格的加载重对齐钉住进度。
 */
export interface ViewProgress {
  frac: number
  cursor?: number
}

const map = new Map<number, ViewProgress>()

export function saveViewProgress(id: number | null, frac: number): void {
  if (id === null) return
  const prev = map.get(id)
  const next = prev ?? { frac: 0 }
  next.frac = Math.min(1, Math.max(0, frac))
  map.set(id, next)
}

export function saveViewCursor(id: number | null, cursor: number): void {
  if (id === null) return
  const prev = map.get(id) ?? { frac: 0 }
  prev.cursor = cursor
  map.set(id, prev)
}

export function loadView(id: number | null): ViewProgress | undefined {
  if (id === null) return undefined
  return map.get(id)
}
