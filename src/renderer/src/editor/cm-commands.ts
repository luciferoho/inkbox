import { type Command, type KeyBinding, type EditorView } from '@codemirror/view'
import { EditorSelection, type Line } from '@codemirror/state'
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
function targetLines(view: EditorView): Line[] {
  const { state } = view
  const out: Line[] = []
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

/* ---------- 列表 Tab / Shift+Tab：降级 / 升级（Typora 习惯） ---------- */

const LIST_LINE_RE = /^(\s*)((?:[-*+]|\d+[.)])[ \t]+)(.*)$/
const ORDERED_RE = /^(\s*)(\d+)([.)])([ \t]+)(.*)$/

/**
 * 有序列表重排号（Tab/Shift+Tab 后随缩进变更一起做，Typora 语义）：
 * Markdown 有序列表按字面起始号渲染——缩进合并后不重排会保留 3. 4. 这类续号，
 * 且「非 1 开头的列表不能打断段落」会让新嵌套项被并进上一行正文（预览里合成一行）。
 * indentOf(n)：行号 → 虚拟缩进（本次已变更行给新值，其余给当前值）。
 * 组的边界：同缩进的连续有序项为一组；更深的子列表与空行不断组；无序项/普通文本断组。
 */
function renumberOrdered(
  view: EditorView,
  indentOf: (n: number) => number
): { from: number; to: number; insert: string }[] {
  const { doc } = view.state
  const total = doc.lines
  const changes: { from: number; to: number; insert: string }[] = []
  const done = new Set<number>()
  for (let n = 1; n <= total; n++) {
    if (done.has(n)) continue
    if (!ORDERED_RE.test(doc.line(n).text)) continue
    const B = indentOf(n)
    if (B < 0) continue // 虚拟缩进 <0 = 本次已移除标记（不再是列表行）
    // 向上找组起点：更深的子列表/空行跳过，同级有序项吞并，其余停
    let start = n
    for (let p = n - 1; p >= 1; p--) {
      const t = doc.line(p).text
      if (!t.trim()) continue
      const om = ORDERED_RE.exec(t)
      if (om && indentOf(p) === B) {
        start = p
        continue
      }
      const lm = LIST_LINE_RE.exec(t)
      if (lm && indentOf(p) > B) continue
      break
    }
    // 向后收集同级连续有序项（穿插更深子列表/空行不断组）
    const seq: number[] = []
    for (let j = start; j <= total; j++) {
      const t = doc.line(j).text
      if (!t.trim()) {
        if (seq.length) continue
        break
      }
      const om = ORDERED_RE.exec(t)
      if (om && indentOf(j) === B) {
        seq.push(j)
        continue
      }
      const lm = LIST_LINE_RE.exec(t)
      if (lm && indentOf(j) > B) continue
      break
    }
    for (let k = 0; k < seq.length; k++) {
      done.add(seq[k])
      const ln = doc.line(seq[k])
      const m = ORDERED_RE.exec(ln.text)
      if (m && Number(m[2]) !== k + 1) {
        const ds = ln.from + m[1].length
        changes.push({ from: ds, to: ds + m[2].length, insert: String(k + 1) })
      }
    }
  }
  return changes
}

/** Tab：列表项行降一级——缩进对齐到上一同级列表项的内容列（跳过更深子树；无参照 +2）。
 *  随后重排受影响的有序组号（新嵌套组从 1 起）。非列表行不接管（交回 indentWithTab） */
export const cmdListIndent: Command = (view) => {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const newIndent = new Map<number, number>()
  for (const line of targetLines(view)) {
    const m = LIST_LINE_RE.exec(line.text)
    if (!m) continue
    const curIndent = m[1].length
    // 向上找同级（缩进 ≤ 当前）的最近列表项作对齐参照；更深的子列表跳过。
    // 参照行也在本次选区里（一起移动）→ 与它保持同级，不按它的内容列再沉一级
    let target = curIndent + 2
    for (let n = line.number - 1; n >= 1; n--) {
      const t = state.doc.line(n).text
      if (!t.trim()) continue
      const pm = LIST_LINE_RE.exec(t)
      if (!pm) break
      if (pm[1].length > curIndent) continue
      target = newIndent.has(n) ? newIndent.get(n)! : pm[1].length + pm[2].length
      break
    }
    newIndent.set(line.number, target)
    if (target !== curIndent) {
      changes.push({ from: line.from, to: line.from + curIndent, insert: ' '.repeat(target) })
    }
  }
  if (newIndent.size === 0) return false
  const curIndentOf = (n: number): number => /^(\s*)/.exec(state.doc.line(n).text)?.[1].length ?? 0
  const renum = renumberOrdered(view, (n) => newIndent.get(n) ?? curIndentOf(n))
  if (changes.length === 0 && renum.length === 0) return false
  view.dispatch({ changes: [...changes, ...renum], scrollIntoView: true })
  return true
}

/** Shift+Tab：列表项行升一级——提升为父项的兄弟（对齐父项缩进）；顶层时去掉标记
 *  = 退出列表。不用固定 -2：有序标记宽度 3，-2 会产生不对齐任何内容列的缩进，
 *  反而触发「非 1 开头列表不能打断段落」把项并进上一行正文。提升后重排父级组号 */
export const cmdListOutdent: Command = (view) => {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const newIndent = new Map<number, number>()
  for (const line of targetLines(view)) {
    const m = LIST_LINE_RE.exec(line.text)
    if (!m) continue
    const cur = m[1].length
    if (cur === 0) {
      // 已在顶层：去掉标记退出列表
      newIndent.set(line.number, -1)
      changes.push({ from: line.from, to: line.from + m[2].length, insert: '' })
      continue
    }
    // 找父项：向上最近的缩进 < 当前 的列表项 → 提升为它的兄弟（同缩进）
    let parentIndent = -1
    for (let n = line.number - 1; n >= 1; n--) {
      const t = state.doc.line(n).text
      if (!t.trim()) continue
      const pm = LIST_LINE_RE.exec(t)
      if (!pm) break
      if (pm[1].length < cur) {
        parentIndent = pm[1].length
        break
      }
    }
    const target = Math.max(parentIndent, 0)
    newIndent.set(line.number, target)
    if (target !== cur) {
      changes.push({ from: line.from, to: line.from + cur, insert: ' '.repeat(target) })
    }
  }
  if (changes.length === 0) return false
  const curIndentOf = (n: number): number => /^(\s*)/.exec(state.doc.line(n).text)?.[1].length ?? 0
  // 标记被移除的行给 -1：重排模型里视为非列表行（不参与分组也不产出 change）
  const renum = renumberOrdered(view, (n) => newIndent.get(n) ?? curIndentOf(n))
  view.dispatch({ changes: [...changes, ...renum], scrollIntoView: true })
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
