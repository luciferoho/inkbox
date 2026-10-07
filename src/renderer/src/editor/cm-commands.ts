import { type Command, type KeyBinding, type EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

/** 选区包裹/解包标记：有选中且已包裹时解包；光标紧邻一对标记（含空对）时移除 */
function wrapSelection(view: Parameters<Command>[0], open: string, close = open): boolean {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const ranges: { anchor: number; head: number }[] = []

  for (const range of state.selection.ranges) {
    const text = state.sliceDoc(range.from, range.to)
    const before = state.sliceDoc(Math.max(0, range.from - open.length), range.from)
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + close.length))
    const wrapped =
      text.length >= open.length + close.length &&
      text.startsWith(open) &&
      text.endsWith(close)
    if (wrapped) {
      // 选区 = 完整标记对：解包，选区保持覆盖内部文本（连续点击 = 加/解循环）
      const inner = text.slice(open.length, text.length - close.length)
      changes.push({ from: range.from, to: range.to, insert: inner })
      ranges.push({ anchor: range.from, head: range.from + inner.length })
    } else if (range.empty && before === open && after === close) {
      // 光标空选区、两侧紧贴标记对：移除这对标记（切换语义，避免标记累积）
      changes.push({ from: range.from - open.length, to: range.from, insert: '' })
      changes.push({ from: range.to, to: range.to + close.length, insert: '' })
      ranges.push({ anchor: range.from - open.length, head: range.from - open.length })
    } else if (!range.empty && before === open && after === close) {
      // 选区 = 标记对内部文本：解包（选区向左扩展 open.length 覆盖同一文本）
      changes.push({ from: range.from - open.length, to: range.from, insert: '' })
      changes.push({ from: range.to, to: range.to + close.length, insert: '' })
      ranges.push({ anchor: range.from - open.length, head: range.to - open.length })
    } else if (range.empty) {
      changes.push({ from: range.from, to: range.to, insert: open + close })
      ranges.push({ anchor: range.from + open.length, head: range.from + open.length })
    } else {
      changes.push({ from: range.from, to: range.to, insert: open + text + close })
      ranges.push({ anchor: range.from + open.length, head: range.to + open.length })
    }
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(
      ranges.map((r) => EditorSelection.range(r.anchor, r.head)),
      state.selection.mainIndex
    )
  })
  return true
}

/** 标题升降级：delta<0 提升（# 变少），delta>0 降级（# 变多） */
function shiftHeading(view: Parameters<Command>[0], delta: number): boolean {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      if (!line.text.trim()) continue
      const m = /^(#{1,6})([ \t]+|$)(.*)$/.exec(line.text)
      if (delta > 0) {
        // 降级：无标题 → h2，有标题 → 深一级（封顶 h6）
        const level = Math.min(6, (m ? m[1].length : 1) + 1)
        changes.push({ from: line.from, to: line.to, insert: `${'#'.repeat(level)} ${m ? m[3] : line.text}` })
      } else {
        // 提升：无标题 → h1，h1 → 正文，其余浅一级（标题文字始终保留）
        if (!m) changes.push({ from: line.from, to: line.to, insert: `# ${line.text}` })
        else if (m[1].length === 1)
          changes.push({ from: line.from, to: line.to, insert: m[3] })
        else
          changes.push({
            from: line.from,
            to: line.to,
            insert: `${'#'.repeat(m[1].length - 1)}${m[3] ? ` ${m[3]}` : ''}`
          })
      }
    }
  }

  if (changes.length === 0) return false
  view.dispatch({ changes })
  return true
}

const wrap = (open: string, close?: string): Command => (view) => wrapSelection(view, open, close)

/* 格式化命令：快捷键与块悬浮工具栏共用同一实现 */
export const cmdBold: Command = wrap('**')
export const cmdItalic: Command = wrap('*')
export const cmdStrike: Command = wrap('~~')
export const cmdInlineCode: Command = wrap('`')
export const cmdHighlight: Command = wrap('==')
export const cmdLink: Command = wrap('[', '](https://)')
export const cmdHeadingUp: Command = (v) => shiftHeading(v, -1)
export const cmdHeadingDown: Command = (v) => shiftHeading(v, 1)

/* ---------- 结构类内置快捷键（Typora 习惯，不进设置页） ---------- */

/** 位置是否在代码围栏/HTML 块内：结构类键不碰代码内容 */
function inBlockNode(state: EditorView['state'], pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1)
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'HTMLBlock') return true
    node = node.parent
  }
  return false
}

/** 选区覆盖的行（跨行选区含首尾行），跳过空行与代码围栏内行 */
function targetLines(view: EditorView): { from: number; to: number; text: string }[] {
  const { state } = view
  const out: { from: number; to: number; text: string }[] = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      if (!line.text.trim() || inBlockNode(state, line.from)) continue
      out.push(line)
    }
  }
  return out
}

/** 行级前缀改写：每行执行 rewrite，一次事务提交 */
function rewriteLines(
  view: EditorView,
  rewrite: (text: string) => string | null
): boolean {
  const changes: { from: number; to: number; insert: string }[] = []
  for (const line of targetLines(view)) {
    const next = rewrite(line.text)
    if (next !== null && next !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: next })
    }
  }
  if (changes.length === 0) return false
  view.dispatch({ changes })
  return true
}

const HEADING_RE = /^(#{1,6})([ \t]+|$)(.*)$/

/** 设标题为 level 级；已是该级 → 退回正文（toggle）。已有其他级标题时取其文字重建，旧 # 不残留 */
export const setHeading = (level: number): Command => (view) =>
  rewriteLines(view, (text) => {
    const m = HEADING_RE.exec(text)
    if (m && m[1].length === level) return m[3]
    return `${'#'.repeat(level)} ${m ? m[3] : text}`
  })

/** 转正文：去掉标题前缀（无前缀的行不动） */
export const cmdBodyText: Command = (view) =>
  rewriteLines(view, (text) => {
    const m = HEADING_RE.exec(text)
    return m ? m[3] : null
  })

const QUOTE_RE = /^(\s*)(>\s?)(.*)$/

/** 切换引用：无 > 前缀加「> 」，有则去掉 */
export const cmdToggleQuote: Command = (view) =>
  rewriteLines(view, (text) => {
    const m = QUOTE_RE.exec(text)
    if (m) return `${m[1]}${m[3]}`
    return text.replace(/^(\s*)/, '$1> ')
  })

const LIST_ITEM_RE = /^(\s*)(?:([-*+])\s+(\[[ xX]\]\s+)?|(\d+)([.)])\s+)(.*)$/

/** 切换无序列表：无标记加「- 」，有序/其他标记替换为「- 」，已是无序去掉 */
export const cmdToggleUnordered: Command = (view) =>
  rewriteLines(view, (text) => {
    const m = LIST_ITEM_RE.exec(text)
    if (!m) return text.trim() ? text.replace(/^(\s*)/, '$1- ') : null
    if (m[2] === '-') return `${m[1]}${m[6]}` // 已无序：退出列表
    return `${m[1]}- ${m[6]}` // 有序 → 无序
  })

/** 切换有序列表：无标记加「1. 」，其他标记替换为「1. 」，已是有序去掉 */
export const cmdToggleOrdered: Command = (view) =>
  rewriteLines(view, (text) => {
    const m = LIST_ITEM_RE.exec(text)
    if (!m) return text.trim() ? text.replace(/^(\s*)/, '$11. ') : null
    if (m[4]) return `${m[1]}${m[6]}` // 已有序：退出列表
    return `${m[1]}1. ${m[6]}` // 无序 → 有序
  })

/** 插入代码块：在当前行之后插入空围栏，光标落首行（连续按可连续插入，Ctrl+Shift+K） */
export const cmdCodeBlock: Command = (view) => {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const insert = '\n```\n\n```'
  view.dispatch(
    state.update({ changes: { from: line.to, insert }, selection: { anchor: line.to + 5 } })
  )
  return true
}

/** 插入表格：在当前行之后插入两列表格骨架，光标落首个表头单元格（Ctrl+T） */
export const cmdInsertTable: Command = (view) => {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const insert = '\n| 列1 | 列2 |\n| --- | --- |\n|  |  |'
  view.dispatch(
    state.update({ changes: { from: line.to, insert }, selection: { anchor: line.to + 3 } })
  )
  return true
}

/* ---------- 列表/引用自动续行（1.10 智能补全） ---------- */

/**
 * Enter 续行（Typora 习惯）：
 * - `- item` / `* x` / `+ x` 回车 → 下一项（继承缩进）
 * - `- [ ] 任务` 回车 → 下一项且勾选框重置为未勾选
 * - `1. item` / `2) item` 回车 → 序号 +1（保留分隔符样式）
 * - `> 引用` 回车 → 续引用行
 * - 空项（标记后无内容）回车 → 删除标记结束列表
 * - 光标在标记区内回车、或不在列表/引用行 → 交回默认换行
 */
export const continueList: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) return false
  const head = range.head
  // 代码围栏里的 "- x"/"1. x" 是代码不是列表：不续行
  let fence: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1)
  while (fence) {
    if (fence.name === 'FencedCode') return false
    fence = fence.parent
  }
  const line = state.doc.lineAt(head)
  const m = /^(\s*)(?:([-*+]\s+(?:\[[ xX]\]\s+)?)|(\d+)([.)])\s+|(>\s?))/.exec(line.text)
  if (!m) return false
  const markerEnd = m[0].length
  if (head < line.from + markerEnd) return false // 光标还在标记里：默认换行

  const before = line.text.slice(markerEnd, head - line.from)
  const after = line.text.slice(head - line.from)
  // 空项回车：删掉标记与缩进，结束列表（光标落行首）
  if (!before.trim() && !after.trim()) {
    view.dispatch(
      view.state.update({
        changes: { from: line.from, to: line.from + markerEnd },
        selection: { anchor: line.from }
      })
    )
    return true
  }
  let next: string
  if (m[4]) next = `${m[1]}${Number(m[3]) + 1}${m[4]} ` // 有序：序号+1，保留 . 或 )
  else if (m[2]) next = `${m[1]}${m[2].replace(/\[[xX]\]/, '[ ]')}` // 无序/任务：勾选框重置
  else next = `${m[1]}${m[5]}` // 引用
  // 显式光标到新项标记后（不带 selection 时光标默认留在插入文本之前，后续输入会落在上一行）
  view.dispatch(
    view.state.update({
      changes: { from: head, insert: `\n${next}` },
      selection: { anchor: head + 1 + next.length }
    })
  )
  return true
}

/** 退格删列表标记（补回被禁用的内置 deleteMarkupBackward）：
 *  光标紧跟标记末尾时，Backspace 一次删掉整个标记而非单个字符（空项退出列表的另一半） */
export const deleteListMarker: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) return false
  const head = range.head
  const line = state.doc.lineAt(head)
  const m = /^(\s*)(?:([-*+]\s+(?:\[[ xX]\]\s+)?)|(\d+)([.)])\s+|(>\s?))/.exec(line.text)
  if (!m) return false
  const markerEnd = m[0].length
  if (head !== line.from + markerEnd) return false // 光标必须紧贴标记尾
  view.dispatch(
    view.state.update({
      changes: { from: line.from, to: line.from + markerEnd },
      selection: { anchor: line.from }
    })
  )
  return true
}

export const formattingKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: cmdBold },
  { key: 'Mod-i', run: cmdItalic },
  /* 字符键 + Shift 的绑定必须写 Shift 后的实际字符（CM 按 event.key 匹配，
     'Mod-Shift-x' 形式匹配不上任何真实键击——删除线/行内代码此前一直失灵） */
  { key: 'Mod-X', run: cmdStrike },
  { key: 'Mod-C', run: cmdInlineCode },
  { key: 'Mod-k', run: cmdLink },
  { key: 'Mod-Equal', run: cmdHeadingUp },
  { key: 'Mod-Minus', run: cmdHeadingDown },
  /* 结构类内置键（Typora 习惯）：标题级别 / 列表 / 引用 / 插入——不进设置页改键 */
  { key: 'Mod-1', run: setHeading(1) },
  { key: 'Mod-2', run: setHeading(2) },
  { key: 'Mod-3', run: setHeading(3) },
  { key: 'Mod-4', run: setHeading(4) },
  { key: 'Mod-5', run: setHeading(5) },
  { key: 'Mod-6', run: setHeading(6) },
  { key: 'Mod-0', run: cmdBodyText },
  { key: 'Mod-{', run: cmdToggleOrdered },
  { key: 'Mod-}', run: cmdToggleUnordered },
  { key: 'Mod-Q', run: cmdToggleQuote },
  { key: 'Mod-K', run: cmdCodeBlock },
  { key: 'Mod-t', run: cmdInsertTable }
]
