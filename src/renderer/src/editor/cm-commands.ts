import { type Command, type KeyBinding } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

/** 选区包裹/解包标记：再按一次取消（有选中且已包裹时解包） */
function wrapSelection(view: Parameters<Command>[0], open: string, close = open): boolean {
  const { state } = view
  const changes: { from: number; to: number; insert: string }[] = []
  const ranges: { anchor: number; head: number }[] = []

  for (const range of state.selection.ranges) {
    const text = state.sliceDoc(range.from, range.to)
    const wrapped =
      text.length >= open.length + close.length &&
      text.startsWith(open) &&
      text.endsWith(close)
    if (wrapped) {
      const inner = text.slice(open.length, text.length - close.length)
      changes.push({ from: range.from, to: range.to, insert: inner })
      ranges.push({ anchor: range.from, head: range.from + inner.length })
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
        // 提升：无标题 → h1，h1 → 正文，其余浅一级
        if (!m) changes.push({ from: line.from, to: line.to, insert: `# ${line.text}` })
        else if (m[1].length === 1)
          changes.push({ from: line.from, to: line.to, insert: m[3] })
        else
          changes.push({
            from: line.from,
            to: line.from + m[0].length,
            insert: `${'#'.repeat(m[1].length - 1)} `
          })
      }
    }
  }

  if (changes.length === 0) return false
  view.dispatch({ changes })
  return true
}

const wrap = (open: string, close?: string): Command => (view) => wrapSelection(view, open, close)

export const formattingKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: wrap('**') },
  { key: 'Mod-i', run: wrap('*') },
  { key: 'Mod-Shift-x', run: wrap('~~') },
  { key: 'Mod-Shift-c', run: wrap('`') },
  { key: 'Mod-k', run: wrap('[', '](https://)') },
  { key: 'Mod-Equal', run: (v) => shiftHeading(v, -1) },
  { key: 'Mod-Minus', run: (v) => shiftHeading(v, 1) }
]
