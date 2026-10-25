/**
 * 每标签一份浏览进度（同一文档的所有模式共享，不按模式分开记忆）：
 * - frac：垂直滚动进度 0..1（scrollTop / 可滚动高度）。各模式布局不同，
 *   语义统一为「读到文档大约哪里」——模式切换时各窗格对齐到它，保持同一位置。
 *   比例对「图片加载前后高度不同」的文档有固有漂移（同 frac 落到不同像素），
 *   精确恢复用 anchor（内容锚：块行号 + 块内偏移，高度变化不漂移）。
 * - cursor：源码光标位置（仅源码编辑器写入/恢复，跨模式保持编辑状态）。
 * 内存级，不持久化。图片加载改变高度期间由各窗格的加载重对齐钉住进度。
 */
export interface ViewAnchor {
  kind: 'top' | 'bottom' | 'block'
  line?: number
  offset?: number
}

export interface ViewProgress {
  frac: number
  cursor?: number
  /** 预览切签精确恢复用（内容锚）；仅预览窗格写入 */
  anchor?: ViewAnchor
}

const map = new Map<number, ViewProgress>()

export function saveViewProgress(id: number | null, frac: number): void {
  if (id === null) return
  const prev = map.get(id)
  const next = prev ?? { frac: 0 }
  next.frac = Math.min(1, Math.max(0, frac))
  map.set(id, next)
}

export function saveViewAnchor(id: number | null, anchor: ViewAnchor): void {
  if (id === null) return
  const prev = map.get(id) ?? { frac: 0 }
  prev.anchor = anchor
  map.set(id, prev)
}

/** 锚点只在预览可见时写入，其余模式滚过的位置不更新它——离开这类模式
 *  （编辑/即显）落袋时必须清掉，否则下次双栏恢复会按过期锚点落位 */
export function clearViewAnchor(id: number | null): void {
  if (id === null) return
  const prev = map.get(id)
  if (prev) delete prev.anchor
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
