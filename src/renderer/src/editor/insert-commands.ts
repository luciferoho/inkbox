import type { EditorView as PMView } from '@milkdown/kit/prose/view'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { Transaction } from '@milkdown/kit/prose/state'
import type { Node as PMNode, NodeType } from '@milkdown/kit/prose/model'
import { wrapIn } from '@milkdown/kit/prose/commands'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import {
  cmdInsertTable,
  cmdCodeBlock,
  cmdInsertMathBlock,
  cmdLink,
  cmdToggleQuote,
  cmdToggleOrdered,
  cmdToggleUnordered
} from './cm-commands'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { requestLinkSourceFocus } from './wysiwyg-extensions'
import { openLangEditorFor } from './pm-codeblock-chrome'
import { insertImageFromDisk } from './insert-image'

/**
 * 插入命令层（5.4 插入面板 / 5.8 右键菜单共用）：
 * 每条命令带即显（ProseMirror，经 pm-registry 取活动视图）与源码（CodeMirror）
 * 两套实现，按调用时的活动编辑器择一执行。图片命令走 insert-image 服务
 * （按焦点自动落点，双端通用）。纯 ProseMirror 实现，不依赖 Milkdown
 * editor 实例（命令层在组件外，拿不到 ctx）。
 */

export type InsertTarget = 'pm' | 'cm'

/** 面板/菜单打开瞬间捕捉焦点所在的编辑器（面板抢焦点前调用） */
export function detectInsertTarget(): InsertTarget {
  for (const v of pmViews()) if (v.hasFocus()) return 'pm'
  for (const v of cmViews()) if (v && v.hasFocus) return 'cm'
  // 无焦点记录（右键后焦点还在文档上时走不到这）：按默认回落
  return 'pm'
}

function pm(): PMView | null {
  return pmViews().filter((v) => v.dom && v.dom.isConnected).pop() ?? null
}

function cm(): ReturnType<typeof cmViews>[number] | null {
  return cmViews().filter((v) => v && v.dom && v.dom.isConnected).pop() ?? null
}

/* ---------- ProseMirror 侧插入实现 ---------- */

function blockAfter(
  view: PMView,
  nodes: PMNode[],
  caret?: (tr: Transaction, at: number) => void
): boolean {
  const { state } = view
  if (!(state.selection instanceof TextSelection)) return false
  const { $from } = state.selection
  const run = (at: number, replace: { from: number; to: number } | null): void => {
    const tr = state.tr
    if (replace) tr.replaceWith(replace.from, replace.to, nodes)
    else tr.insert(at, nodes)
    caret?.(tr, replace ? replace.from : at)
    view.dispatch(tr.scrollIntoView())
  }
  const tryAt = (depth: number, replace: { from: number; to: number } | null): boolean => {
    try {
      const at = replace ? replace.from : state.selection.$from.after(depth)
      run(at, replace)
      return true
    } catch {
      return false // 容器放不下该节点（列表项/单元格内插代码块等）
    }
  }
  const parent = $from.parent
  if (parent.type.name === 'paragraph' && parent.content.size === 0) {
    if (tryAt(0, { from: $from.before(), to: $from.after() })) return true
  }
  if (tryAt($from.depth, null)) return true
  // 深层容器（列表/引用/单元格）放不下：退到顶层块之后
  return tryAt(1, null)
}

function pmInsertTable(view: PMView): boolean {
  const s = view.state.schema
  const tableT = s.nodes.table
  const rowT = s.nodes.table_row
  const headerT = s.nodes.table_header
  const cellT = s.nodes.table_cell
  const paraT = s.nodes.paragraph
  if (!tableT || !rowT || !headerT || !cellT || !paraT) return false
  const cell = (type: NodeType, text: string): PMNode =>
    type.create(null, paraT.create(null, text ? s.text(text) : null))
  const table = tableT.create(null, [
    rowT.create(null, [cell(headerT, '列1'), cell(headerT, '列2')]),
    rowT.create(null, [cell(cellT, ''), cell(cellT, '')])
  ])
  return blockAfter(view, [table], (tr, at) => {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 4)))
  })
}

function pmInsertCodeBlock(view: PMView, language = ''): boolean {
  const codeT = view.state.schema.nodes.code_block
  if (!codeT) return false
  const block = codeT.create(language ? { language } : null)
  // 插入后第一件事是选语言：光标落块内 + dispatch 完成后直接调起语言编辑器
  let insertedAt = -1
  const ok = blockAfter(view, [block], (tr, at) => {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
    insertedAt = at
  })
  if (ok && !language) openLangEditorFor(view, insertedAt)
  return ok
}

function pmInsertMathBlock(view: PMView): boolean {
  const mathT = view.state.schema.nodes.math_block
  if (!mathT) return false
  // NodeSelection 让公式视图进入嵌套编辑态（与 $$ 输入规则同款）
  return blockAfter(view, [mathT.create()], (tr, at) => {
    tr.setSelection(NodeSelection.create(tr.doc, at))
  })
}

function pmInsertLink(view: PMView): boolean {
  const { state } = view
  const linkT = state.schema.marks.link
  if (!linkT || !(state.selection instanceof TextSelection)) return false
  const { from, to, empty } = state.selection
  const tr = state.tr
  if (state.doc.rangeHasMark(from, to, linkT)) {
    tr.removeMark(from, to, linkT)
    view.dispatch(tr.scrollIntoView())
    return true
  }
  if (empty) {
    const text = '链接'
    tr.insertText(text, from, to)
    tr.addMark(from, from + text.length, linkT.create({ href: '' }))
    // 光标落链接内最后一个字符后（to-1）：末尾边界 to 已归属「离开」不再展开
    tr.setSelection(TextSelection.create(tr.doc, Math.max(from, to - 1)))
  } else {
    tr.addMark(from, to, linkT.create({ href: '' }))
    tr.setSelection(TextSelection.create(tr.doc, Math.max(from, to - 1)))
  }
  requestLinkSourceFocus()
  view.dispatch(tr.scrollIntoView())
  return true
}

function pmInsertQuote(view: PMView): boolean {
  const bq = view.state.schema.nodes.blockquote
  if (!bq) return false
  return wrapIn(bq)(view.state, view.dispatch, view)
}

function pmInsertList(view: PMView, ordered: boolean): boolean {
  const listT = view.state.schema.nodes[ordered ? 'ordered_list' : 'bullet_list']
  if (!listT) return false
  return wrapInList(listT)(view.state, view.dispatch, view)
}

function pmInsertTaskList(view: PMView): boolean {
  const bl = view.state.schema.nodes.bullet_list
  if (!bl) return false
  if (!wrapInList(bl)(view.state, view.dispatch, view)) return false
  // 刚包成的列表项置为未勾选（milkdown gfm list_item.checked）
  const { $from } = view.state.selection
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'list_item') {
      view.dispatch(view.state.tr.setNodeMarkup($from.before(d), undefined, { checked: false }))
      break
    }
  }
  return true
}

function pmInsertToc(view: PMView): boolean {
  const tocT = view.state.schema.nodes.toc
  if (!tocT) return false
  return blockAfter(view, [tocT.create()])
}

function pmInsertHr(view: PMView): boolean {
  const hrT = view.state.schema.nodes.hr
  const paraT = view.state.schema.nodes.paragraph
  if (!hrT || !paraT) return false
  return blockAfter(view, [hrT.create(), paraT.create()], (tr, at) => {
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)))
  })
}

/** 脚注：光标处插引用；文末补定义（编号 = 现有定义数 +1） */
function pmInsertFootnote(view: PMView): boolean {
  const { state } = view
  const refT = state.schema.nodes.footnote_reference
  const defT = state.schema.nodes.footnote_definition
  const paraT = state.schema.nodes.paragraph
  if (!refT || !defT || !(state.selection instanceof TextSelection)) return false
  let n = 0
  state.doc.descendants((node) => {
    if (node.type.name === 'footnote_definition') n++
    return true
  })
  const id = String(n + 1)
  const tr = state.tr
  const at = state.selection.to
  tr.insert(at, refT.create({ identifier: id, label: id }))
  const def = defT.create({ identifier: id }, paraT.create(null, state.schema.text(` `)))
  const insertAt = state.doc.content.size
  tr.insert(insertAt, def)
  tr.setSelection(TextSelection.create(tr.doc, at + 2))
  view.dispatch(tr.scrollIntoView())
  return true
}

function pmInsertText(view: PMView, text: string): boolean {
  const { state } = view
  if (!(state.selection instanceof TextSelection)) return false
  const { from, to } = state.selection
  const tr = state.tr.insertText(text, from, to)
  view.dispatch(tr.scrollIntoView())
  return true
}

/* ---------- CodeMirror 侧插入实现 ---------- */

function cmInsertFence(view: NonNullable<ReturnType<typeof cm>>, lang: string): boolean {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const insert = '\n```' + lang + '\n\n```'
  view.dispatch(
    state.update({ changes: { from: line.to, insert }, selection: { anchor: line.to + 5 + lang.length } })
  )
  return true
}

function cmInsertTextAtCursor(view: NonNullable<ReturnType<typeof cm>>, text: string): boolean {
  const { state } = view
  const head = state.selection.main.head
  view.dispatch(state.update({ changes: { from: head, insert: text }, selection: { anchor: head + text.length } }))
  return true
}

function cmInsertFootnote(view: NonNullable<ReturnType<typeof cm>>): boolean {
  const { state } = view
  let n = 0
  const text = state.doc.toString()
  n = (text.match(/^\[\^(\d+)\]:/gm) ?? []).length
  const id = String(n + 1)
  const head = state.selection.main.head
  view.dispatch(
    state.update({
      changes: [
        { from: head, insert: `[^${id}]` },
        { from: state.doc.length, insert: `\n\n[^${id}]: ` }
      ],
      selection: { anchor: head + id.length + 3 }
    })
  )
  return true
}

function cmInsertHr(view: NonNullable<ReturnType<typeof cm>>): boolean {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  view.dispatch(
    state.update({
      changes: { from: line.to, insert: '\n\n---\n' },
      selection: { anchor: line.to + 5 }
    })
  )
  return true
}

/* ---------- 命令注册表 ---------- */

export interface InsertCommand {
  id: string
  /** i18n 键（ip.*） */
  labelKey: string
  run(target: InsertTarget): boolean
}

const both = (
  id: string,
  labelKey: string,
  pmRun: (view: PMView) => boolean,
  cmRun?: (view: NonNullable<ReturnType<typeof cm>>) => boolean
): InsertCommand => ({
  id,
  labelKey,
  run(target) {
    if (target === 'pm') {
      const v = pm()
      return v ? pmRun(v) : false
    }
    const v = cm()
    return v ? (cmRun ? cmRun(v) : false) : false
  }
})

export const INSERT_COMMANDS: InsertCommand[] = [
  both('table', 'ip.table', pmInsertTable, cmdInsertTable),
  both('codeBlock', 'ip.codeBlock', (v) => pmInsertCodeBlock(v), cmdCodeBlock),
  both('math', 'ip.math', pmInsertMathBlock, cmdInsertMathBlock),
  both('mermaid', 'ip.mermaid', (v) => pmInsertCodeBlock(v, 'mermaid'), (v) => cmInsertFence(v, 'mermaid')),
  {
    id: 'image',
    labelKey: 'ip.image',
    run() {
      // insert-image 服务按焦点落点，双端通用
      void insertImageFromDisk()
      return true
    }
  },
  both('link', 'ip.link', pmInsertLink, cmdLink),
  both('quote', 'ip.quote', pmInsertQuote, cmdToggleQuote),
  both('olList', 'ip.olList', (v) => pmInsertList(v, true), cmdToggleOrdered),
  both('ulList', 'ip.ulList', (v) => pmInsertList(v, false), cmdToggleUnordered),
  both(
    'taskList',
    'ip.taskList',
    pmInsertTaskList,
    (v) => cmInsertTextAtCursor(v, '- [ ] ')
  ),
  both('toc', 'ip.toc', pmInsertToc, (v) => cmInsertTextAtCursor(v, '[TOC]')),
  both('footnote', 'ip.footnote', pmInsertFootnote, cmInsertFootnote),
  both('hr', 'ip.hr', pmInsertHr, cmInsertHr),
  both('emoji', 'ip.emoji', (v) => pmInsertText(v, '😀'), (v) => cmInsertTextAtCursor(v, '😀')),
  both('date', 'ip.date', (v) => pmInsertText(v, new Date().toISOString().slice(0, 10)), (v) =>
    cmInsertTextAtCursor(v, new Date().toISOString().slice(0, 10))
  )
]

export function runInsertCommand(id: string, target: InsertTarget): boolean {
  const cmd = INSERT_COMMANDS.find((c) => c.id === id)
  if (!cmd) return false
  const ok = cmd.run(target)
  // 面板/菜单点击会夺走编辑器焦点，命令结束后交回。
  // 例外：无语言代码块会紧接着打开语言编辑器——PM host 持有焦点时
  // input.focus() 会被 PM 的选区重占顶掉（实测拉锯战），由编辑器自行持焦
  if (ok && !(id === 'codeBlock' && target === 'pm')) {
    const v = target === 'pm' ? pm() : cm()
    if (v) v.focus()
  }
  return ok
}
