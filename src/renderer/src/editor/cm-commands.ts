import { type Command, type KeyBinding, type EditorView } from '@codemirror/view'
import { EditorSelection, type Line, type Text } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { applyTableOp, cellStart, detectTable, type TableOp } from './table-utils'
import { openTableGrid } from './table-grid'
import { cmInFence, cmFormatCodeBlock } from './code-format'

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

/** 链接（Ctrl+K）：包成 `[文字](https://)` 后选区落到地址占位上，直接输入覆盖；
 *  无选区插入 `[](https://)`，光标落文字位（先补文字再点地址区） */
export const cmdLink: Command = (view) => {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const ranges: { anchor: number; head: number }[] = []
  for (const range of state.selection.ranges) {
    const text = state.sliceDoc(range.from, range.to)
    if (range.empty) {
      const insert = '[](https://)'
      changes.push({ from: range.from, to: range.to, insert })
      ranges.push({ anchor: range.from + 1, head: range.from + 1 })
    } else {
      changes.push({ from: range.from, to: range.to, insert: `[${text}](https://)` })
      const urlStart = range.from + 1 + text.length + 2
      ranges.push({ anchor: urlStart, head: urlStart + 'https://'.length })
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

/** 设标题为 level 级；已是该级 → 退回正文（toggle）。已有其他级标题时取其文字重建，旧 # 不残留。
 *  空行也生效：插入「#### 」并落光标行尾（Typora 语义）——空行此前被跳过，空文档下快捷键像失灵 */
export const setHeading = (level: number): Command => (view) => {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const emptyLineEnds: number[] = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      if (inBlockNode(state, line.from)) continue
      const m = HEADING_RE.exec(line.text)
      const next = line.text.trim()
        ? m && m[1].length === level
          ? m[3]
          : `${'#'.repeat(level)} ${m ? m[3] : line.text}`
        : `${'#'.repeat(level)} `
      if (next !== line.text) {
        changes.push({ from: line.from, to: line.to, insert: next })
        if (!line.text.trim()) emptyLineEnds.push(line.from + next.length)
      }
    }
  }
  if (changes.length === 0) return false
  // 空行插入的「# 」：光标落到行尾（继续输入即标题内容）
  const anchor = emptyLineEnds.length ? emptyLineEnds[emptyLineEnds.length - 1] : undefined
  view.dispatch({
    changes,
    ...(anchor !== undefined ? { selection: { anchor } } : {}),
    scrollIntoView: false
  })
  return true
}

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

/** 插入代码块：在当前行之后插入空围栏，光标落 ``` 后——先输语言
 *  （fence 补全弹候选），Enter/续写进入块内（连续按可连续插入，Ctrl+Shift+K） */
export const cmdCodeBlock: Command = (view) => {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const insert = '\n```\n\n```'
  view.dispatch(
    state.update({ changes: { from: line.to, insert }, selection: { anchor: line.to + 4 } })
  )
  return true
}

/** 插入公式块：在当前行之后插入 $$ 围栏，光标落中间空行（Ctrl+Shift+M，Typora 键位） */
export const cmdInsertMathBlock: Command = (view) => {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const insert = '\n$$\n\n$$'
  view.dispatch(
    state.update({ changes: { from: line.to, insert }, selection: { anchor: line.to + 4 } })
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

const LIST_LINE_RE = /^(\s*)((?:[-*+]|\d+[.)])(?:[ \t]+|$))(.*)$/
const ORDERED_RE = /^(\s*)(\d+)([.)])(?:[ \t]+|$)(.*)$/
const LEADING_WS_RE = /^(\s*)/

/**
 * 有序列表重排号（Tab/Shift+Tab 后随缩进变更一起做，Typora 语义）：
 * Markdown 有序列表按字面起始号渲染——缩进合并后不重排会保留 3. 4. 这类续号，
 * 且「非 1 开头的列表不能打断段落」会让新嵌套项被并进上一行正文（预览里合成一行）。
 * indentOf(n)：行号 → 虚拟缩进（本次已变更行给新值；-1 = 标记已移除，非列表行）。
 * 组的边界（只重排包含 seeds 的组，未涉及的组一律不动）：
 * - 空行断组：隔空行的两个有序列表是用户心智里的两个独立列表
 * - 更深的子列表不断组；无序项/普通文本断组
 */
function renumberOrdered(
  view: EditorView,
  indentOf: (n: number) => number,
  seeds: Set<number>
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
    // 向上找组起点：更深的子列表跳过，同级有序项吞并，空行/无序/普通文本断组
    let start = n
    let hasSeed = seeds.has(n)
    for (let p = n - 1; p >= 1; p--) {
      const t = doc.line(p).text
      if (!t.trim()) break
      const om = ORDERED_RE.exec(t)
      if (om && indentOf(p) === B) {
        start = p
        if (seeds.has(p)) hasSeed = true
        continue
      }
      const lm = LIST_LINE_RE.exec(t)
      if (lm && indentOf(p) > B) continue
      break
    }
    // 向后收集同级连续有序项
    const seq: number[] = []
    for (let j = start; j <= total; j++) {
      const t = doc.line(j).text
      if (!t.trim()) break
      const om = ORDERED_RE.exec(t)
      if (om && indentOf(j) === B) {
        seq.push(j)
        if (seeds.has(j)) hasSeed = true
        continue
      }
      const lm = LIST_LINE_RE.exec(t)
      if (lm && indentOf(j) > B) continue
      break
    }
    for (const ln of seq) done.add(ln)
    if (!hasSeed) continue
    for (let k = 0; k < seq.length; k++) {
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
  const renum = renumberOrdered(view, (n) => newIndent.get(n) ?? curIndentOf(n), new Set(newIndent.keys()))
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
  const renum = renumberOrdered(view, (n) => newIndent.get(n) ?? curIndentOf(n), new Set(newIndent.keys()))
  view.dispatch({ changes: [...changes, ...renum], scrollIntoView: true })
  return true
}

/**
 * 源码模式实时重排（编辑后由 updateListener 调用）：
 * - 光标在有序项上 → 所在组编号顺序化
 * - 光标在空行上（回车断开列表的瞬间）→ 空行后的有序组视为新列表，从 1 重排；
 *   反向（删除空行合并回去）→ 合并后的组顺序化接续上文
 * 与预览渲染语义保持一致（渲染按 <ol> 顺序编号，源码字面号跟随归一）。
 * 组的边界：连续顶层有序项；更深的子列表跳过；空行/无序顶格/普通文本断组。
 * 起始号：隔空行跟随另一个列表 → 1；否则保留首项字面号（「3. 1922 年」类意图）。
 * 重排派发后会再触发一次 updateListener，此时编号已顺序化，不再产出变更，自然收敛。
 */
export function autoRenumberFollowingList(view: EditorView, head: number): boolean {
  const { state } = view
  const headLine = state.doc.lineAt(head)
  const seen = new Set<number>()
  // 已有路径：光标在有序项上 → 所在组重排
  if (/^\d+[.)][ \t]/.test(headLine.text)) {
    const done = renumberGroupAt(view, headLine.number, seen)
    if (done) return true
  }
  // 新路径：光标在空行上（回车断开列表）→ 空行后的有序组从 1 重排
  if (!headLine.text.trim()) {
    let j = headLine.number + 1
    while (j <= state.doc.lines && !state.doc.line(j).text.trim()) j++
    if (j <= state.doc.lines && /^\d+[.)][ \t]/.test(state.doc.line(j).text)) {
      return renumberGroupAt(view, j, seen)
    }
  }
  return false
}

/** 重排 startLine 所在的有序组：组内编号顺序化。起始号取
 *  「隔空行跟随另一个列表 → 1（空行 = 新列表）；否则 → 首项字面号（保留
 *  「3. 1922 年」类起始意图）」。删除空行合并回去时组内不连续的编号会被顺序化 */
function renumberGroupAt(view: EditorView, startLine: number, seen: Set<number>): boolean {
  const { state } = view
  // 组起点向上：连续顶层有序项；更深缩进（子列表）跳过；空行/无序顶格/文本断组
  let start = startLine
  for (let p = startLine - 1; p >= 1; p--) {
    const t = state.doc.line(p).text
    if (/^\d+[.)][ \t]/.test(t)) {
      start = p
      continue
    }
    if (/^\s/.test(t)) continue
    break
  }
  // 组向下收集
  const seq: number[] = []
  for (let j = start; j <= state.doc.lines; j++) {
    const t = state.doc.line(j).text
    if (/^\d+[.)][ \t]/.test(t)) {
      seq.push(j)
      seen.add(j)
      continue
    }
    if (/^\s/.test(t)) continue
    break
  }
  // 起始号：组前（跳过空行）还有另一个列表行 → 从 1（新列表）；否则保留首项字面号
  let followsList = false
  for (let p = start - 1; p >= 1; p--) {
    const t = state.doc.line(p).text
    if (!t.trim()) continue
    followsList = /^(?:[-*+]|\d+[.)])[ \t]/.test(t)
    break
  }
  const firstLiteral = Number(/^(\d+)/.exec(state.doc.line(start).text)?.[1] ?? 1)
  const startNum = followsList ? 1 : firstLiteral
  const changes: { from: number; to: number; insert: string }[] = []
  for (let k = 0; k < seq.length; k++) {
    const expect = startNum + k
    const ln = state.doc.line(seq[k])
    const m = /^(\d+)([.)])/.exec(ln.text)
    if (m && Number(m[1]) !== expect) {
      changes.push({ from: ln.from, to: ln.from + m[1].length, insert: String(expect) })
    }
  }
  if (changes.length === 0) return false
  view.dispatch({ changes, scrollIntoView: false })
  return true
}

/* ---------- 列表项整体上移/下移（M6 6.1；即显侧在 list-move.ts） ---------- */

interface ListBlock {
  start: number
  end: number
  indent: number
}

/** 编号槽：新序中各项首行的编号信息（组边界规则与 renumberOrdered 一致） */
interface MoveSlot {
  moved: boolean
  origFrom: number | null // 未移动行 = 原文档行首（补号 change 走原文档坐标）
  num: number | null // 原字面号（无序行 null）
  wsLen: number
  numLen: number
  lineText: string // 移动行 = insert 片的首行，补号后回填
}

/** 项块向下吞并：缩进更深的行（续行/嵌套子树）归属本项；空行/同级项断块 */
function blockEndOf(doc: Text, start: number, indent: number): number {
  let end = start
  while (end < doc.lines) {
    const t = doc.line(end + 1).text
    if (!t.trim()) break
    const pm = LIST_LINE_RE.exec(t)
    if (pm && pm[1].length <= indent) break
    end++
  }
  return end
}

/** 光标所属列表项块：光标行即列表行 = 项首行；续行向上找最近的、缩进小于本行的
 *  列表首行。空行视为不在项内（保守：含空行的松散列表不参与移动）。非列表 → null */
export function cmListBlockAt(view: EditorView): ListBlock | null {
  const { doc, selection } = view.state
  const headLine = doc.lineAt(selection.main.head)
  const headM = LIST_LINE_RE.exec(headLine.text)
  let start = headLine.number
  let indent = -1
  if (headM) {
    indent = headM[1].length
  } else {
    const headLead = LEADING_WS_RE.exec(headLine.text)?.[1].length ?? 0
    for (let n = headLine.number - 1; n >= 1; n--) {
      const t = doc.line(n).text
      if (!t.trim()) return null
      const pm = LIST_LINE_RE.exec(t)
      if (pm && pm[1].length < headLead) {
        start = n
        indent = pm[1].length
        break
      }
    }
  }
  if (indent < 0) return null
  return { start, end: blockEndOf(doc, start, indent), indent }
}

/** 从边界行向 dir 走找相邻同级项：'sibling' = 相邻兄弟首行；'parent' = 撞到浅层行
 *  （dir=-1 时该行即父项首行；dir=+1 撞到的可能是叔项，父项另行向上找）；null = 边界 */
function adjacentItem(
  doc: Text,
  fromLine: number,
  dir: -1 | 1,
  indent: number
): { kind: 'sibling' | 'parent'; line: number } | null {
  let q = fromLine
  for (;;) {
    const nq = q + dir
    if (nq < 1 || nq > doc.lines) return null
    const t = doc.line(nq).text
    if (!t.trim()) return null
    const pm = LIST_LINE_RE.exec(t)
    if (pm) {
      if (pm[1].length === indent) return { kind: 'sibling', line: nq }
      if (pm[1].length < indent) return { kind: 'parent', line: nq }
      q = nq // 更深的子树行，继续
      continue
    }
    if ((LEADING_WS_RE.exec(t)?.[1].length ?? 0) > indent) {
      q = nq // 兄长/父项的续行，继续
      continue
    }
    return null
  }
}

/** 光标项的父项首行（向上跳过兄弟与更深层）；无 → -1 */
function parentItemLine(doc: Text, start: number, indent: number): number {
  for (let n = start - 1; n >= 1; n--) {
    const t = doc.line(n).text
    if (!t.trim()) return -1
    const pm = LIST_LINE_RE.exec(t)
    if (pm && pm[1].length < indent) return n
  }
  return -1
}

/** 有序组成员收集（renumberOrdered 同规则）：同级有序项为成员，同级无序/空行/
 *  浅层普通文本断组，更深子列表跳过 */
function orderedMembers(doc: Text, anchor: number, dir: -1 | 1, indent: number): number[] {
  const out: number[] = []
  let q = anchor
  for (;;) {
    const nq = q + dir
    if (nq < 1 || nq > doc.lines) break
    const t = doc.line(nq).text
    if (!t.trim()) break
    const om = ORDERED_RE.exec(t)
    if (om && om[1].length === indent) {
      out.push(nq)
      q = nq
      continue
    }
    const pm = LIST_LINE_RE.exec(t)
    if (pm && pm[1].length > indent) {
      q = nq // 更深子列表跳过
      continue
    }
    break
  }
  return out
}

function slotOf(doc: Text, lineNo: number): MoveSlot {
  const line = doc.line(lineNo)
  const m = ORDERED_RE.exec(line.text)
  return {
    moved: false,
    origFrom: line.from,
    num: m ? Number(m[2]) : null,
    wsLen: m ? m[1].length : 0,
    numLen: m ? m[2].length : 0,
    lineText: line.text
  }
}

/** 新序编号：连续有序段起始号取段首字面号（保留「3. 1922 年」类意图，与即显
 *  <ol> 位置计数语义一致），无序行断段复位。未移动行出原文档坐标的补号 change；
 *  移动行返回补丁首行，由调用方回填进 insert 文本 */
function renumberMoved(
  slots: MoveSlot[],
  changes: { from: number; to: number; insert: string }[]
): Map<MoveSlot, string> {
  const movedPatch = new Map<MoveSlot, string>()
  let runBase = 1
  let runIdx = 0
  for (const s of slots) {
    if (s.num === null) {
      runBase = 1
      runIdx = 0
      continue
    }
    if (runIdx === 0) runBase = s.num
    const expect = runBase + runIdx
    runIdx++
    if (expect === s.num) continue
    if (s.moved) {
      movedPatch.set(
        s,
        s.lineText.slice(0, s.wsLen) + String(expect) + s.lineText.slice(s.wsLen + s.numLen)
      )
    } else if (s.origFrom !== null) {
      changes.push({
        from: s.origFrom + s.wsLen,
        to: s.origFrom + s.wsLen + s.numLen,
        insert: String(expect)
      })
    }
  }
  return movedPatch
}

/** 补号后的首行回填进文本片（首行整体替换，其余行原样） */
function patchPiece(piece: string, patch: string | undefined): string {
  if (patch === undefined) return piece
  const i = piece.indexOf('\n')
  return i < 0 ? patch : patch + piece.slice(i)
}

/** 列表项整体上移/下移（源码侧，Ctrl+Shift+↑/↓ 与右键「列表项」组共用）：
 *  相邻兄弟 = 两块文本对调（总长不变、行数不变）；首项上移/末项下移 = 整项提出
 *  子列表落父项外侧（缩进降为父级，父项剥掉该子列表）。单事务单历史项 */
export function cmMoveListItem(view: EditorView, dir: -1 | 1): boolean {
  const blk = cmListBlockAt(view)
  if (!blk) return false
  const doc = view.state.doc
  const sel = view.state.selection.main
  const curFrom = doc.line(blk.start).from
  const curTo = doc.line(blk.end).to
  const curText = doc.sliceString(curFrom, curTo)
  const curFirst = curText.split('\n')[0]
  const c0 = ORDERED_RE.exec(curFirst)

  /* 路径判定：兄弟交换 or 边界提升 */
  let sibLine = -1
  let liftParent = -1
  if (dir < 0) {
    const prev = adjacentItem(doc, blk.start, -1, blk.indent)
    if (prev?.kind === 'sibling') sibLine = prev.line
    else if (prev?.kind === 'parent') liftParent = prev.line
    else return false
  } else {
    const next = adjacentItem(doc, blk.end, 1, blk.indent)
    if (next?.kind === 'sibling') sibLine = next.line
    else if (next?.kind === 'parent') liftParent = parentItemLine(doc, blk.start, blk.indent)
    else return false
  }

  const changes: { from: number; to: number; insert: string }[] = []

  if (liftParent >= 1) {
    /* ---- 边界提升：整项提出子列表，落父项外侧 ---- */
    const pM = LIST_LINE_RE.exec(doc.line(liftParent).text)
    if (!pM) return false
    const pIndent = pM[1].length
    // 嵌套列表首行：父项头之后第一个更深层列表行
    let nlStart = -1
    for (let n = liftParent + 1; n <= blk.start; n++) {
      const pm = LIST_LINE_RE.exec(doc.line(n).text)
      if (pm && pm[1].length > pIndent) {
        nlStart = n
        break
      }
    }
    if (nlStart < 0) return false
    // 父项整块末行（含子列表与松散续行）
    let pEnd = liftParent
    while (pEnd < doc.lines) {
      const t = doc.line(pEnd + 1).text
      if (!t.trim()) break
      const x = LIST_LINE_RE.exec(t)
      if ((x ? x[1].length : (LEADING_WS_RE.exec(t)?.[1].length ?? 0)) > pIndent) pEnd++
      else break
    }
    const mainFrom = doc.line(liftParent).from
    const mainTo = doc.line(pEnd).to
    const A = doc.sliceString(mainFrom, doc.line(nlStart).from) // 父项头（含尾 \n）
    const B = blk.end < pEnd ? doc.sliceString(curTo + 1, mainTo) : '' // 项后内容（cur 原占的换行随项移走）
    const d = blk.indent - pIndent
    const curPiece = curText.replace(new RegExp(`^ {1,${d}}`, 'gm'), '')
    const patchedCur = curPiece.split('\n')[0]
    const parentFirst = doc.line(liftParent).text
    const p0 = ORDERED_RE.exec(parentFirst)
    const slots: MoveSlot[] = []
    for (const n of orderedMembers(doc, liftParent, -1, pIndent)) slots.push(slotOf(doc, n))
    const curSlot: MoveSlot = {
      moved: true,
      origFrom: null,
      num: c0 ? Number(c0[2]) : null,
      wsLen: c0 ? c0[1].length : 0,
      numLen: c0 ? c0[2].length : 0,
      lineText: patchedCur
    }
    const parentSlot: MoveSlot = {
      moved: true,
      origFrom: null,
      num: p0 ? Number(p0[2]) : null,
      wsLen: p0 ? p0[1].length : 0,
      numLen: p0 ? p0[2].length : 0,
      lineText: parentFirst
    }
    if (dir < 0) slots.push(curSlot, parentSlot)
    else slots.push(parentSlot, curSlot)
    for (const n of orderedMembers(doc, pEnd, 1, pIndent)) slots.push(slotOf(doc, n))
    const movedPatch = renumberMoved(slots, changes)
    const curP = patchPiece(curPiece, movedPatch.get(curSlot))
    const aP = patchPiece(A, movedPatch.get(parentSlot))
    const insert = dir < 0 ? curP + '\n' + aP + B : aP + B + (B ? '\n' : '') + curP
    const newCurStart = dir < 0 ? mainFrom : mainFrom + aP.length + B.length + (B ? 1 : 0)
    // 选区映射：块内相对偏移平移，光标行缩进被削的列差一并扣除
    const mapPos = (pos: number): number => {
      const ln = doc.lineAt(pos)
      const col = pos - ln.from
      const stripped = Math.min(d, LEADING_WS_RE.exec(ln.text)?.[1].length ?? 0, col)
      return Math.max(1, newCurStart + (pos - curFrom - stripped))
    }
    changes.push({ from: mainFrom, to: mainTo, insert })
    changes.sort((a, b) => a.from - b.from)
    view.dispatch({
      changes,
      selection: { anchor: mapPos(sel.anchor), head: mapPos(sel.head) },
      scrollIntoView: true
    })
    return true
  }

  /* ---- 相邻兄弟交换：总长/行数不变，其他行位置稳定 ---- */
  const sibEnd = blockEndOf(doc, sibLine, blk.indent)
  const sibFrom = doc.line(sibLine).from
  const sibTo = doc.line(sibEnd).to
  const mainFrom = dir < 0 ? sibFrom : curFrom
  const mainTo = dir < 0 ? curTo : sibTo
  // 兄弟块体（不含它与当前项之间的那个换行——该换行随当前项移动）
  const sibBody = dir < 0 ? doc.sliceString(sibFrom, curFrom - 1) : doc.sliceString(curTo + 1, sibTo)
  const sibFirst = sibBody.split('\n')[0]
  const s0 = ORDERED_RE.exec(sibFirst)
  const slots: MoveSlot[] = []
  for (const n of orderedMembers(doc, dir < 0 ? sibLine : blk.start, -1, blk.indent))
    slots.push(slotOf(doc, n))
  const curSlot: MoveSlot = {
    moved: true,
    origFrom: null,
    num: c0 ? Number(c0[2]) : null,
    wsLen: c0 ? c0[1].length : 0,
    numLen: c0 ? c0[2].length : 0,
    lineText: curFirst
  }
  const sibSlot: MoveSlot = {
    moved: true,
    origFrom: null,
    num: s0 ? Number(s0[2]) : null,
    wsLen: s0 ? s0[1].length : 0,
    numLen: s0 ? s0[2].length : 0,
    lineText: sibFirst
  }
  if (dir < 0) slots.push(curSlot, sibSlot)
  else slots.push(sibSlot, curSlot)
  for (const n of orderedMembers(doc, dir < 0 ? blk.end : sibEnd, 1, blk.indent))
    slots.push(slotOf(doc, n))
  const movedPatch = renumberMoved(slots, changes)
  const insert =
    dir < 0
      ? patchPiece(curText, movedPatch.get(curSlot)) +
        '\n' +
        patchPiece(sibBody, movedPatch.get(sibSlot))
      : patchPiece(sibBody, movedPatch.get(sibSlot)) +
        '\n' +
        patchPiece(curText, movedPatch.get(curSlot))
  const newCurStart = dir < 0 ? mainFrom : mainFrom + sibBody.length + 1
  const mapPos = (pos: number): number => Math.max(1, newCurStart + (pos - curFrom))
  changes.push({ from: mainFrom, to: mainTo, insert })
  changes.sort((a, b) => a.from - b.from)
  view.dispatch({
    changes,
    selection: { anchor: mapPos(sel.anchor), head: mapPos(sel.head) },
    scrollIntoView: true
  })
  return true
}

/** 围栏内 Shift+Alt+F 入口：先同步判围栏（不在围栏返回 false 放行键位） */
function cmFormatKey(view: EditorView): boolean {
  if (!cmInFence(view)) return false
  void cmFormatCodeBlock(view)
  return true
}

/** 顶层块上移/下移（M6 6.2 源码侧）：lezer 顶层节点定位当前块（标题/段落/围栏/
 *  表格/引用/列表整块），与相邻顶层块对调（两块间空行随 insert 重组、长度不变）；
 *  首末块边界不动作。单事务单历史项 */
export function cmMoveBlock(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view
  const head = state.selection.main.head
  const top = syntaxTree(state).topNode
  let cur = null
  for (let ch = top.firstChild; ch; ch = ch.nextSibling) {
    if (head >= ch.from && head < ch.to) {
      cur = ch
      break
    }
  }
  if (!cur) {
    // 文档末尾光标：落最后一个顶层块
    for (let ch = top.lastChild; ch; ch = ch.prevSibling) {
      if (head <= ch.to) {
        cur = ch
        break
      }
    }
  }
  if (!cur) return false
  const sib = dir < 0 ? cur.prevSibling : cur.nextSibling
  if (!sib) return false
  const curText = state.sliceDoc(cur.from, cur.to)
  const sibText = state.sliceDoc(sib.from, sib.to)
  const gap = state.sliceDoc(dir < 0 ? sib.to : cur.to, dir < 0 ? cur.from : sib.from)
  const aFrom = Math.min(cur.from, sib.from)
  const bTo = Math.max(cur.to, sib.to)
  const insert = dir < 0 ? curText + gap + sibText : sibText + gap + curText
  const newCurStart = dir < 0 ? aFrom : aFrom + sibText.length + gap.length
  const off = Math.min(head - cur.from, curText.length)
  view.dispatch({
    changes: { from: aFrom, to: bTo, insert },
    selection: { anchor: newCurStart + off, head: newCurStart + off },
    scrollIntoView: true
  })
  return true
}

/** 重复当前块/行（M6 6.5 源码侧）：有选区复制选区插到其后；无选区复制当前行
 *  （含换行插到行后），光标落副本行同列。单事务可撤销 */
export function cmDuplicate(view: EditorView): boolean {
  const sel = view.state.selection.main
  if (!sel.empty) {
    const text = view.state.sliceDoc(sel.from, sel.to)
    if (!text) return false
    view.dispatch({
      changes: { from: sel.to, insert: text },
      selection: { anchor: sel.to + text.length },
      scrollIntoView: true
    })
    return true
  }
  const line = view.state.doc.lineAt(sel.head)
  // 副本插到行后：换行打头（'行文本 + \n' 会让副本与本行同行）
  const insert = '\n' + line.text
  const col = sel.head - line.from
  view.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: line.to + 1 + Math.min(col, line.text.length) },
    scrollIntoView: true
  })
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
  { key: 'Mod-M', run: cmdInsertMathBlock },
  // 5.6：Ctrl+T 弹 5×5 行列网格选择器（不再直接插固定 2 列）
  { key: 'Mod-t', run: (view) => (openTableGrid('cm', view), true) },
  /* 表格内 Alt+方向键：整行/整列移动；Ctrl+Enter：下方插入行
     （Typora 同键位，与表格右键菜单同语义——右键菜单 accel 文案依赖这些绑定） */
  { key: 'Alt-ArrowUp', run: cmTableStructural('row-move-up') },
  { key: 'Alt-ArrowDown', run: cmTableStructural('row-move-down') },
  { key: 'Alt-ArrowLeft', run: cmTableStructural('col-move-left') },
  { key: 'Alt-ArrowRight', run: cmTableStructural('col-move-right') },
  { key: 'Mod-Enter', run: cmTableStructural('row-below') },
  { key: 'Mod-Shift-Backspace', run: cmTableStructural('row-delete') },
  /* 列表项内 Ctrl+Shift+↑/↓：整项上移/下移（6.1）；非列表 = 顶层块移动（6.2） */
  { key: 'Mod-Shift-ArrowUp', run: (view) => cmMoveListItem(view, -1) || cmMoveBlock(view, -1) },
  { key: 'Mod-Shift-ArrowDown', run: (view) => cmMoveListItem(view, 1) || cmMoveBlock(view, 1) },
  /* 围栏内 Shift+Alt+F：就地格式化（6.3；非围栏放行，失败 toast 在模块内） */
  { key: 'Shift-Alt-f', run: (view) => cmFormatKey(view) },
  /* Ctrl+D：重复当前行/选区（6.5） */
  { key: 'Mod-d', run: cmDuplicate }
]

/** 光标处表格结构操作（不在表格内返回 false 放行方向键/回车原有行为） */
function cmTableStructural(
  action: 'row-move-up' | 'row-move-down' | 'col-move-left' | 'col-move-right' | 'row-below' | 'row-delete'
): Command {
  return (view) => {
    const pos = view.state.selection.main.head
    const line = view.state.doc.lineAt(pos)
    const info = detectTable(
      view.state.doc.lines,
      (n) => view.state.doc.line(n).text,
      line.number,
      pos - line.from
    )
    if (!info) return false
    const lines: string[] = []
    for (let n = info.startLine; n <= info.endLine; n++) lines.push(view.state.doc.line(n).text)
    const op: TableOp =
      action === 'row-move-up'
        ? { kind: 'row-up' }
        : action === 'row-move-down'
          ? { kind: 'row-down' }
          : action === 'col-move-left'
            ? { kind: 'col-move-left' }
            : action === 'col-move-right'
              ? { kind: 'col-move-right' }
              : action === 'row-delete'
                ? { kind: 'row-delete' }
                : { kind: 'row-below' }
    const edit = applyTableOp(lines, info, op)
    if (!edit) return true // 表格内：不可执行也吞掉按键（边界移动不落默认行为）
    const blockFrom = view.state.doc.line(info.startLine).from
    const anchor =
      blockFrom +
      edit.lines.slice(0, Math.min(edit.cursorLine, edit.lines.length - 1)).reduce(
        (acc, text) => acc + text.length + 1,
        0
      ) +
      cellStart(edit.lines[Math.min(edit.cursorLine, edit.lines.length - 1)], edit.cursorCol)
    view.dispatch({
      changes: { from: blockFrom, to: view.state.doc.line(info.endLine).to, insert: edit.lines.join('\n') },
      selection: { anchor }
    })
    return true
  }
}
