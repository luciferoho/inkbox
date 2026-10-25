import { $view } from '@milkdown/kit/utils'
import { hrSchema } from '@milkdown/kit/preset/commonmark'
import { NodeSelection } from '@milkdown/kit/prose/state'

/**
 * 即显分割线 nodeView：外层 wrap 提供点击判定区（hr 本体 1~3px 点不中，
 * 「无法选中删除」的根因），内部保留真 <hr> 元素——主题的 hr 线规则
 * （border/背景）继续生效。
 * 捕获阶段 mousedown → 手动派发 NodeSelection（PM 内置点击命中对 1px 线
 * 不可靠）；选中后 Backspace 删除（行首 Backspace 走 leaf-delete keymap）。
 */
export const hrView = $view(hrSchema.node, () => (node, view, getPos) => {
  const wrap = document.createElement('div')
  wrap.className = 'luci-hr'
  wrap.appendChild(document.createElement('hr'))
  // 捕获阶段先于 PM 处理：选区派发 + preventDefault 阻止 PM 的默认光标逻辑
  wrap.addEventListener(
    'mousedown',
    (e) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined
      if (typeof pos !== 'number') return
      e.preventDefault()
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
    },
    true
  )
  return {
    dom: wrap,
    selectNode(): void {
      wrap.classList.add('luci-hr--sel')
    },
    deselectNode(): void {
      wrap.classList.remove('luci-hr--sel')
    },
    ignoreMutation(): boolean {
      return true
    },
    stopEvent(e: Event): boolean {
      return e.type === 'mousedown'
    }
  }
})
