import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { buildRegex, expandReplacement, type FindQuery, type FindStatus } from '@/find-shared'

export type { FindQuery, FindStatus } from '@/find-shared'

/**
 * 即显模式查找替换（ProseMirror 层实现）：
 * - 匹配计算按文本块逐个进行（不跨块；Typora 同样以块内为主），
 *   覆盖段落/标题/表格单元格/代码块行等所有 textblock
 * - 命中以 Decoration 高亮（.pm-find-hit），当前项（.pm-find-hit-active）随导航移动
 * - 文档变化时（开着查找条时在正文打字）自动重算，活动项映射到最近位置
 * - 定位滚动用手动坐标滚动（scrollPosIntoView）：tr.scrollIntoView 依赖 DOM 选区，
 *   焦点在查找条（未聚焦编辑器）时不会滚动——用户实测踩过的坑
 * - 插件状态只存「查询 + 命中 + 活动索引」，Vue 侧经 onFindStatus 订阅回显
 */

interface FindPluginState {
  open: boolean
  query: FindQuery
  matches: { from: number; to: number }[]
  active: number
  error: boolean
}

type FindMeta =
  | { type: 'result'; open: true; query: FindQuery; matches: { from: number; to: number }[]; active: number; error: boolean }
  | { type: 'active'; idx: number }
  | { type: 'close' }

export const findKey = new PluginKey<FindPluginState>('luci-find')

const initState: FindPluginState = {
  open: false,
  query: { text: '', caseSensitive: false, regexp: false, wholeWord: false },
  matches: [],
  active: -1,
  error: false
}

/** UI 状态回显回调（组件挂载时注册） */
let statusSink: ((s: FindStatus) => void) | null = null

export function onFindStatus(cb: ((s: FindStatus) => void) | null): void {
  statusSink = cb
}

function statusOf(s: FindPluginState): FindStatus {
  return { open: s.open, count: s.matches.length, active: s.active, error: s.error }
}

interface FindMatch {
  from: number
  to: number
}

/** 逐文本块收集匹配（base = 块内容起始位置 pos+1） */
function computeMatches(doc: PMNode, q: FindQuery): { matches: FindMatch[]; error: boolean } {
  if (!q.text) return { matches: [], error: false }
  const re = buildRegex(q)
  if (!re) return { matches: [], error: true }
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock || !node.textContent) return
    const base = pos + 1
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(node.textContent))) {
      if (!m[0]) {
        re.lastIndex++ // 零宽匹配（如 a*）防死循环
        continue
      }
      matches.push({ from: base + m.index, to: base + m.index + m[0].length })
    }
  })
  return { matches, error: false }
}

/** 第一个起点 ≥ pos 的命中；没有则回绕到第一个（Typora/VSCode 语义） */
function pickFrom(matches: FindMatch[], pos: number): number {
  for (let i = 0; i < matches.length; i++) if (matches[i].from >= pos) return i
  return matches.length ? 0 : -1
}

function withMeta(tr: Transaction, meta: FindMeta): Transaction {
  tr.setMeta(findKey, meta)
  return tr
}

/**
 * 无论编辑器是否持有焦点都把 pos 滚到可视区（margin 内贴边，否则不动）。
 * PM 的 tr.scrollIntoView 走 DOM 选区坐标，查找条聚焦时编辑器无焦点、
 * DOM 选区不在编辑器内 → 滚动失效（用户反馈「点上下箭头不定位」的根因）。
 */
function scrollPosIntoView(view: EditorView, pos: number): void {
  let box: { top: number; bottom: number } | null = null
  try {
    box = view.coordsAtPos(pos) as { top: number; bottom: number } | null
  } catch {
    return
  }
  if (!box) return
  let el: HTMLElement | null = view.dom as HTMLElement
  while (el) {
    const oy = getComputedStyle(el).overflowY
    if (oy === 'auto' || oy === 'scroll') break
    el = el.parentElement
  }
  if (!el) return
  const rect = el.getBoundingClientRect()
  const margin = 72
  if (box.top < rect.top + margin) el.scrollTop += box.top - rect.top - margin
  else if (box.bottom > rect.bottom - margin) el.scrollTop += box.bottom - rect.bottom + margin
}

export function createFindPlugin(): Plugin<FindPluginState> {
  return new Plugin<FindPluginState>({
    key: findKey,
    state: {
      init: () => initState,
      apply(tr, prev) {
        const meta = tr.getMeta(findKey) as FindMeta | undefined
        if (meta?.type === 'close') return { ...initState }
        if (meta?.type === 'result') {
          return { open: true, query: meta.query, matches: meta.matches, active: meta.active, error: meta.error }
        }
        if (meta?.type === 'active') return { ...prev, active: meta.idx }
        if (tr.docChanged && prev.open) {
          const r = computeMatches(tr.doc, prev.query)
          const old = prev.matches[prev.active]
          const anchor = old ? tr.mapping.map(old.from, -1) : null
          return { ...prev, matches: r.matches, error: r.error, active: anchor === null ? -1 : pickFrom(r.matches, anchor) }
        }
        return prev
      }
    },
    props: {
      decorations(state) {
        const s = findKey.getState(state)
        if (!s?.open || !s.matches.length) return DecorationSet.empty
        const decos = s.matches.map((m, i) =>
          Decoration.inline(m.from, m.to, {
            class: i === s.active ? 'pm-find-hit pm-find-hit-active' : 'pm-find-hit'
          })
        )
        return DecorationSet.create(state.doc, decos)
      }
    },
    view: () => ({
      update(view, prevState) {
        if (!statusSink) return
        const a = findKey.getState(prevState)
        const b = findKey.getState(view.state)
        if (!b || a === b) return
        if (a && a.open === b.open && a.matches.length === b.matches.length && a.active === b.active && a.error === b.error) {
          return
        }
        statusSink(statusOf(b))
      }
    })
  })
}

/* ---------- 面向 UI 的操作 ---------- */

/** 打开查找条：查询状态由组件持有并传入（唯一真源，重开不分叉） */
export function findOpen(view: EditorView, query: FindQuery): void {
  const r = computeMatches(view.state.doc, query)
  const idx = pickFrom(r.matches, view.state.selection.from)
  view.dispatch(withMeta(view.state.tr, { type: 'result', open: true, query, matches: r.matches, active: idx, error: r.error }))
  if (idx >= 0) scrollPosIntoView(view, r.matches[idx].from)
}

export function findClose(view: EditorView): void {
  view.dispatch(withMeta(view.state.tr, { type: 'close' }))
}

/** 查询变化：重算命中并定位到光标后第一个（打字即搜） */
export function findSetQuery(view: EditorView, query: FindQuery): void {
  const r = computeMatches(view.state.doc, query)
  const idx = pickFrom(r.matches, view.state.selection.from)
  const tr = view.state.tr
  if (idx >= 0) {
    const m = r.matches[idx]
    tr.setSelection(TextSelection.create(tr.doc, m.from, m.to))
  }
  view.dispatch(withMeta(tr, { type: 'result', open: true, query, matches: r.matches, active: idx, error: r.error }))
  if (idx >= 0) scrollPosIntoView(view, r.matches[idx].from)
}

/** 上一个 / 下一个（Enter / Shift+Enter），回绕循环 */
export function findGo(view: EditorView, dir: 1 | -1): void {
  const s = findKey.getState(view.state)
  if (!s?.open || !s.matches.length) return
  const n = s.matches.length
  const idx = (s.active + dir + n) % n
  const m = s.matches[idx]
  const tr = view.state.tr
  tr.setSelection(TextSelection.create(tr.doc, m.from, m.to))
  view.dispatch(withMeta(tr, { type: 'active', idx }))
  scrollPosIntoView(view, m.from)
}

/** 替换当前项并前进到下一个 */
export function findReplaceCurrent(view: EditorView, replacement: string): void {
  const s = findKey.getState(view.state)
  const m = s?.matches[s.active]
  if (!s || !m) return
  const matched = view.state.doc.textBetween(m.from, m.to, '\n', '￼')
  const text = expandReplacement(s.query, matched, replacement)
  const tr = view.state.tr
  tr.insertText(text, m.from, m.to)
  // tr.doc 已含替换结果：重算命中并前进到替换点之后的第一个
  const r = computeMatches(tr.doc, s.query)
  const idx = pickFrom(r.matches, m.from + text.length)
  if (idx >= 0) {
    const m2 = r.matches[idx]
    tr.setSelection(TextSelection.create(tr.doc, m2.from, m2.to))
  }
  view.dispatch(withMeta(tr, { type: 'result', open: true, query: s.query, matches: r.matches, active: idx, error: false }))
  scrollPosIntoView(view, idx >= 0 ? r.matches[idx].from : m.from)
}

/** 全部替换：按旧文档坐标逆序应用（后面的替换不影响前面位置），单事务可撤销 */
export function findReplaceAll(view: EditorView, replacement: string): void {
  const s = findKey.getState(view.state)
  if (!s || !s.matches.length) return
  const tr = view.state.tr
  for (let i = s.matches.length - 1; i >= 0; i--) {
    const m = s.matches[i]
    const matched = s.query.regexp ? view.state.doc.textBetween(m.from, m.to, '\n', '￼') : ''
    tr.insertText(expandReplacement(s.query, matched, replacement), m.from, m.to)
  }
  const r = computeMatches(tr.doc, s.query)
  const idx = pickFrom(r.matches, view.state.selection.from)
  view.dispatch(withMeta(tr, { type: 'result', open: true, query: s.query, matches: r.matches, active: idx, error: false }))
  if (idx >= 0) scrollPosIntoView(view, r.matches[idx].from)
}
