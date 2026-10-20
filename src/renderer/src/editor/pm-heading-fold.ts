import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

/**
 * 即显模式标题折叠（ROADMAP 2.9）：每个标题左侧一个 chevron 箭头，点击折叠/
 * 展开该标题区段（到下一个同级或更高级标题为止）。
 * 纯装饰器实现：折叠 = 区段内顶层块加 pm-fold-hidden（CSS 隐藏），不改文档、
 * 不影响序列化；折叠位置随事务映射（标题被删则自动遗忘）。
 * 光标保护：折叠时若选区落在将被隐藏的区段内，先移回标题行尾。
 */

interface FoldState {
  /** 已折叠标题的文档位置（升序） */
  folded: number[]
}

interface FoldMeta {
  pos: number
  on: boolean
}

const key = new PluginKey<FoldState>('luci-heading-fold')

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'

/** 标题扫描：顶层标题节点 { 位置, 层级 } */
function scanHeadings(doc: PMNode): { pos: number; level: number }[] {
  const heads: { pos: number; level: number }[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading') {
      heads.push({ pos: offset, level: Number(node.attrs.level ?? 1) })
    }
  })
  return heads
}

/** 标题区段终点：下一个同级或更高级标题的位置；无则文档末尾 */
function sectionEnd(heads: { pos: number; level: number }[], idx: number, docSize: number): number {
  const level = heads[idx].level
  for (let i = idx + 1; i < heads.length; i++) {
    if (heads[i].level <= level) return heads[i].pos
  }
  return docSize
}

function applyFold(prev: FoldState, tr: Transaction): FoldState {
  let folded = prev.folded
  const meta = tr.getMeta(key) as FoldMeta[] | FoldMeta | undefined
  if (meta) {
    const set = new Set(folded)
    for (const m of Array.isArray(meta) ? meta : [meta]) {
      if (m.on) set.add(m.pos)
      else set.delete(m.pos)
    }
    folded = [...set].sort((a, b) => a - b)
  }
  if (tr.docChanged && folded.length > 0) {
    folded = folded
      .map((p) => {
        const r = tr.mapping.mapResult(p, -1)
        return r.deleted ? -1 : r.pos
      })
      .filter((p) => p >= 0)
  }
  if (folded === prev.folded) return prev
  return { folded }
}

/** 折叠箭头 toDOM（Decoration.widget 接收 (view, getPos) => DOM 的函数形态）：
 *  箭头挂在标题元素内部首位，hover 显现；折叠时常显并指向右侧 */
function makeFoldArrow(pos: number, folded: boolean): (view: EditorView) => HTMLElement {
  return (view: EditorView): HTMLElement => {
    const btn = document.createElement('button')
    btn.className = 'pm-fold-arrow' + (folded ? ' folded' : '')
    btn.setAttribute('contenteditable', 'false')
    btn.innerHTML = CHEVRON
    btn.addEventListener('mousedown', (e) => {
      // 抢在 PM 之前处理：不移动光标、不进入编辑
      e.preventDefault()
      e.stopPropagation()
      toggleFold(view, pos, !folded)
    })
    return btn
  }
}

/** 切换折叠：on = 折叠区段（光标在区段内则先移回标题行尾） */
function toggleFold(view: EditorView, headingPos: number, on: boolean): void {
  const { state } = view
  const node = state.doc.nodeAt(headingPos)
  if (!node || node.type.name !== 'heading') return
  if (!on) {
    const tr = state.tr.setMeta(key, { pos: headingPos, on: false })
    view.dispatch(tr)
    return
  }
  const heads = scanHeadings(state.doc)
  const idx = heads.findIndex((h) => h.pos === headingPos)
  if (idx < 0) return
  const headingEnd = headingPos + node.nodeSize
  const end = sectionEnd(heads, idx, state.doc.content.size)
  const tr = state.tr
  const { from, to } = state.selection
  if (to > headingEnd && from < end) {
    // 选区/光标将被隐藏：移回标题行尾
    tr.setSelection(TextSelection.create(state.doc, headingEnd))
  }
  tr.setMeta(key, { pos: headingPos, on: true })
  view.dispatch(tr)
}

function buildDecos(state: EditorState, folded: number[]): DecorationSet {
  const doc = state.doc
  const heads = scanHeadings(doc)
  const decos: Decoration[] = []

  // 每个标题的折叠箭头：pos+1 = 标题内容起点（widget 成为 h1 内部首位；
  // 若挂在块起始 pos，PM 会把它渲染成标题的兄弟节点，独占一行）
  for (const h of heads) {
    const isFolded = folded.includes(h.pos)
    decos.push(Decoration.widget(h.pos + 1, makeFoldArrow(h.pos, isFolded), { side: -1 }))
  }

  // 折叠区段：隐藏标题之后、区段终点之前的顶层块
  if (folded.length > 0) {
    for (const pos of folded) {
      const idx = heads.findIndex((h) => h.pos === pos)
      if (idx < 0) continue
      const headingNode = doc.nodeAt(pos)
      if (!headingNode) continue
      const headingEnd = pos + headingNode.nodeSize
      const end = sectionEnd(heads, idx, doc.content.size)
      if (end <= headingEnd) continue
      doc.forEach((node, offset) => {
        if (offset >= headingEnd && offset < end) {
          decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'pm-fold-hidden' }))
        }
      })
    }
  }
  return DecorationSet.create(doc, decos)
}

export function createHeadingFoldPlugin(): Plugin {
  return new Plugin({
    key,
    state: {
      init: (): FoldState => ({ folded: [] }),
      apply: (tr, prev) => applyFold(prev, tr),
    },
    props: {
      decorations: (state): DecorationSet => {
        const fs = key.getState(state)
        if (!fs) return DecorationSet.empty
        return buildDecos(state, fs.folded)
      },
    },
  })
}
