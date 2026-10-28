import { $view } from '@milkdown/kit/utils'
import { tableSchema } from '@milkdown/kit/preset/gfm'
import type { Node as PmNode } from '@milkdown/kit/prose/model'

/**
 * 即显表格 nodeView：外层横向滚动容器。
 *
 * 预览侧由 markdown-it 规则包了 .md-table-wrap（overflow-x:auto），宽表格只在
 * 表格自身范围内横向滚动；即显侧 Milkdown 这版不注册 prosemirror-tables 的
 * TableView（实测表格直接是 .luci-prose 的子节点，无 .tableWrapper），表格
 * width:max-content 超出内容列时会顶破编辑器横向溢出、整页被撑宽。
 *
 * 这里补一个与预览同构的滚动外壳：dom = wrap、contentDOM = tbody（PM 只往
 * tbody 里渲染行）。表格元素本身保留真 <table>，主题的表格规则照常命中。
 */
export const wrappedTableView = $view(tableSchema.node, () => (node) => {
  const wrap = document.createElement('div')
  wrap.className = 'luci-table-wrap'
  const table = document.createElement('table')
  const tbody = document.createElement('tbody')
  table.appendChild(tbody)
  wrap.appendChild(table)
  return {
    dom: wrap,
    contentDOM: tbody,
    update(next: PmNode): boolean {
      return next.type.name === node.type.name
    }
  }
})
