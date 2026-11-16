import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

/**
 * 重复当前块（M6 6.5 即显侧；源码侧 cmDuplicate 在 cm-commands.ts）：
 * Ctrl+D——无选区复制当前顶层块（列表项内复制当前项）插到其后，光标落副本内
 * 同偏移；有选区复制选区文本插到选区后。单事务可撤销
 */
export function pmDuplicate(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection
  if (!sel.empty) {
    const text = state.doc.textBetween(sel.from, sel.to, '\n')
    if (!text) return false
    const tr = state.tr.insertText(text, sel.to)
    tr.setSelection(TextSelection.near(tr.doc.resolve(sel.to + text.length), 1))
    view.dispatch(tr.scrollIntoView())
    return true
  }
  const { $from } = sel
  if ($from.depth < 1) return false
  // 列表项内 → 复制当前项；否则复制顶层块
  let depth = 1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') {
      depth = d
      break
    }
  }
  const node = $from.node(depth)
  const pos = $from.before(depth)
  const insertPos = pos + node.nodeSize
  const tr = state.tr
  tr.insert(insertPos, node.copy(node.content))
  // 光标落副本内同偏移（夹紧进副本内容区）
  const off = Math.max(1, Math.min(sel.head - pos, node.content.size))
  try {
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + off), 1))
  } catch {
    /* 位置异常时保持原选区 */
  }
  view.dispatch(tr.scrollIntoView())
  return true
}
