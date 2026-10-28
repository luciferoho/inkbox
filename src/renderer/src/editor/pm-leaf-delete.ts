import { keymap } from '@milkdown/kit/prose/keymap'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { Command } from '@milkdown/kit/prose/state'

/** 行首 Backspace 删除前面的 leaf 块（分割线/[TOC]/公式块等）：
 *  PM 的 joinNodeBackward 不删 leaf 兄弟节点——表现为「分割线删不掉」。
 *  keymap 插件比 baseKeymap 的 Backspace 先行（milkdown 预设内 keymap
 *  优先级低于编辑器级注册），未命中（非行首/前面不是 leaf 块）则交回默认 */

const deleteLeafBefore: Command = (state, dispatch) => {
  // NodeSelection（点击 wrap/选中的 hr 等 leaf 块）：Backspace 直接删除
  if (state.selection instanceof NodeSelection) {
    if (dispatch) {
      dispatch(state.tr.deleteSelection().scrollIntoView())
    }
    return true
  }
  if (!state.selection.empty) return false
  const { $from } = state.selection
  if ($from.parentOffset !== 0) return false
  const before = $from.nodeBefore
  if (!before || !before.isLeaf || !before.isBlock) return false
  if (dispatch) {
    dispatch(state.tr.delete($from.pos - before.nodeSize, $from.pos).scrollIntoView())
  }
  return true
}

export function createLeafDeletePlugin() {
  return keymap({ Backspace: deleteLeafBefore })
}
