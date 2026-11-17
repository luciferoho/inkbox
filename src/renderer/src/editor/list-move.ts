import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Fragment, type Node as PMNode } from '@milkdown/kit/prose/model'

/**
 * 列表项整体上移/下移（M6 6.1 即显侧；源码侧 cmMoveListItem 在 cm-commands.ts）：
 * Ctrl+Shift+↑/↓ —— 当前列表项（含子列表与续行整体）与相邻兄弟项交换；首项上移/
 * 末项下移时提升出子列表并入父级（父项的兄长/弟弟；顶层列表边界不动作）。
 * 相邻两兄弟或父项整域一次 replaceWith = 单事务单历史项，一次 Ctrl+Z 撤销；
 * 有序标记由 <ol> 原生计数与序列化按位置重推，无需动 label attr；
 * 选区映射：光标在项内的相对偏移平移到移动后的项上，夹紧进项内容区。
 */
const LIST_TYPES = new Set(['bullet_list', 'ordered_list'])

/** 光标是否在列表项内（快捷键与右键菜单显隐共用） */
export function pmInList(state: EditorState): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') return true
  }
  return false
}

/** 从父节点内容剥掉 offset 处的子节点（提升边界用：当前项是子列表唯一孩子时，
 *  空子列表整个消失）。forEach 回调签名 = (child, offset, index)，第二参数才是偏移 */
function withoutChildAt(parent: PMNode, offset: number): PMNode | null {
  const children: PMNode[] = []
  let found = false
  parent.forEach((child, off) => {
    if (off === offset) {
      found = true
      return
    }
    children.push(child)
  })
  return found ? parent.copy(Fragment.fromArray(children)) : null
}

/** 把父节点 offset 处的子节点替换为 replacement（提升边界用：子列表还有兄弟项时，
 *  只摘当前项、子列表留守） */
function withChildReplaced(parent: PMNode, offset: number, replacement: PMNode): PMNode | null {
  const children: PMNode[] = []
  let found = false
  parent.forEach((child, off) => {
    if (off === offset) {
      found = true
      children.push(replacement)
      return
    }
    children.push(child)
  })
  return found ? parent.copy(Fragment.fromArray(children)) : null
}

export function pmMoveListItem(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view
  const { $from } = state.selection
  let itemDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') {
      itemDepth = d
      break
    }
  }
  if (itemDepth < 1) return false
  const item = $from.node(itemDepth)
  const itemStart = $from.before(itemDepth)
  const list = $from.node(itemDepth - 1)
  if (!LIST_TYPES.has(list.type.name)) return false
  const idx = $from.index(itemDepth - 1)

  const tr = state.tr
  let newStart: number

  const first = idx === 0
  const last = idx === list.childCount - 1
  const nested = itemDepth >= 2 && $from.node(itemDepth - 2).type.name === 'list_item'

  if ((dir < 0 && first) || (dir > 0 && last)) {
    // 边界：嵌套时整项提出子列表落到父项外侧。子列表还有兄弟项时留守父项内
    // （只摘当前项）；当前项是唯一孩子时空子列表整个剥掉
    if (!nested) return false
    const parentStart = $from.before(itemDepth - 2)
    const parent = $from.node(itemDepth - 2)
    const listStart = $from.before(itemDepth - 1)
    const listOffset = listStart - (parentStart + 1)
    let newParent: PMNode | null
    if (list.childCount > 1) {
      const rest: PMNode[] = []
      list.forEach((child, _off, i) => {
        if (i !== idx) rest.push(child)
      })
      newParent = withChildReplaced(parent, listOffset, list.copy(Fragment.fromArray(rest)))
    } else {
      newParent = withoutChildAt(parent, listOffset)
    }
    if (!newParent) return false
    tr.replaceWith(
      parentStart,
      parentStart + parent.nodeSize,
      Fragment.fromArray(dir < 0 ? [item, newParent] : [newParent, item])
    )
    newStart = dir < 0 ? parentStart : parentStart + newParent.nodeSize
  } else {
    // 常规：与相邻兄弟整体交换（两兄弟相邻，整域一次替换 = 单历史项）
    const sib = list.child(idx + dir)
    const sibStart = dir < 0 ? itemStart - sib.nodeSize : itemStart + item.nodeSize
    const lo = Math.min(itemStart, sibStart)
    const hi = Math.max(itemStart + item.nodeSize, sibStart + sib.nodeSize)
    tr.replaceWith(lo, hi, Fragment.fromArray(dir < 0 ? [item, sib] : [sib, item]))
    newStart = dir < 0 ? lo : lo + sib.nodeSize
  }

  // 选区跟随：项内相对偏移平移，夹紧进项内容区（newStart+1 .. +content.size）；
  // 用 near 落到合法文本位（偏移恰在块边界时自动就近），越界选区一并收回项内
  const mapPos = (p: number): number =>
    Math.max(newStart + 1, Math.min(newStart + item.content.size, newStart + (p - itemStart)))
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(mapPos(state.selection.head)), 1)
  )
  view.dispatch(tr.scrollIntoView())
  return true
}

/** 顶层块上移/下移（M6 6.2；源码侧 cmMoveBlock 在 cm-commands.ts）：
 *  Ctrl+Shift+↑/↓ 非列表上下文——当前顶层块（段落/标题/代码块/表格/引用块…）
 *  与相邻顶层块整体交换；顶层首/末块边界不动作。相邻域一次 replaceWith 单历史项；
 *  表格列宽记忆按表头取键，整块搬移不受影响 */
export function pmMoveBlock(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view
  const { $from } = state.selection
  if ($from.depth < 1) return false
  const doc = state.doc
  const item = $from.node(1)
  const itemPos = $from.before(1)
  const idx = $from.index(0)
  const sibIdx = idx + dir
  if (sibIdx < 0 || sibIdx >= doc.childCount) return false
  const sib = doc.child(sibIdx)
  const sibStart = dir < 0 ? itemPos - sib.nodeSize : itemPos + item.nodeSize
  const lo = Math.min(itemPos, sibStart)
  const hi = Math.max(itemPos + item.nodeSize, sibStart + sib.nodeSize)
  const tr = state.tr
  tr.replaceWith(lo, hi, Fragment.fromArray(dir < 0 ? [item, sib] : [sib, item]))
  const newStart = dir < 0 ? lo : lo + sib.nodeSize
  const off = Math.max(0, Math.min(state.selection.head - itemPos, item.nodeSize - 1))
  try {
    tr.setSelection(TextSelection.near(tr.doc.resolve(newStart + off), 1))
  } catch {
    /* 位置异常时保持原选区 */
  }
  view.dispatch(tr.scrollIntoView())
  return true
}
