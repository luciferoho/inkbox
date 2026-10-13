import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { Command } from '@milkdown/kit/prose/state'
import { keymap } from '@milkdown/kit/prose/keymap'

/** Esc 跳出引用块：光标移到引用后的空段落（没有就补一个），嵌套引用逐层退出。
 *  列表 Tab/Shift+Tab 不在这里处理——WysiwygEditor 的视图级 handleKeys
 *  优先级更高（同时管代码块缩进），列表逻辑合并在那边。 */

const escapeBlockquote: Command = (state, dispatch) => {
  if (!state.selection.empty) return false
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'blockquote') continue
    const after = $from.after(d)
    const tr = state.tr
    const next = tr.doc.nodeAt(after)
    const barePara = next?.type.name === 'paragraph' && next.content.size === 0
    if (!barePara) tr.insert(after, state.schema.nodes.paragraph.create())
    // after+1 = 引用后那个段落内部（已有的空段或刚补的空段）
    tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1))
    tr.scrollIntoView()
    dispatch?.(tr)
    return true
  }
  return false
}

export function createQuoteEscapePlugin(): Plugin {
  return keymap({ Escape: escapeBlockquote })
}
