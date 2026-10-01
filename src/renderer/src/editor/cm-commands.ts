import { type Command, type KeyBinding } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

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

export const formattingKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: cmdBold },
  { key: 'Mod-i', run: cmdItalic },
  { key: 'Mod-Shift-x', run: cmdStrike },
  { key: 'Mod-Shift-c', run: cmdInlineCode },
  { key: 'Mod-k', run: cmdLink },
  { key: 'Mod-Equal', run: cmdHeadingUp },
  { key: 'Mod-Minus', run: cmdHeadingDown }
]
