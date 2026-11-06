import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { EMOJI_DEFS } from './cm-emoji-completion'

/**
 * emoji 短代码补全 · 即显侧（5.9，对齐源码模式 2.11）：
 * 行首或空白后敲 `:名称前缀` 弹候选，Enter/Tab 或点选插入 emoji 字符，
 * 词表与源码侧同源（markdown-it-emoji full，见 cm-emoji-completion）。
 *
 * - 仅光标塌陷时触发；代码块/HTML 表格/frontmatter/TOC/公式块与行内代码内不补全
 * - 候选条 8 项上限（上下键循环），Esc 关闭且同一前缀下不再自动弹回（继续输入才重开）
 * - 弹层挂 body 用 fixed 定位：编辑器宿主是滚动容器，绝对定位会跟着内容滚走
 */

interface EmojiHit {
  name: string
  char: string
}

interface EmojiPluginState {
  open: boolean
  /** 文档中 ':' 的位置（替换起点） */
  from: number
  /** 光标位置（替换终点） */
  to: number
  /** 冒号后的已输入前缀（小写） */
  query: string
  /** 高亮项索引；-1 = 未选（Enter 取首项） */
  active: number
  /** Esc 关闭时的前缀：同一前缀不再自动弹回 */
  dismissedQuery: string | null
}

interface EmojiMeta {
  move?: 1 | -1
  dismiss?: true
}

export const emojiCompletionKey = new PluginKey<EmojiPluginState>('luci-emoji-completion')

const MAX_ITEMS = 8

/** 这些块内不弹补全（代码/结构化块里短代码没有语义） */
const BLOCKED_NODES = new Set(['code_block', 'html_table', 'yaml', 'toc', 'math_block'])

const TRIGGER_RE = /(?:^|\s):([a-zA-Z0-9_+-]*)$/

interface Ctx {
  from: number
  to: number
  query: string
}

function detectContext(state: EditorState): Ctx | null {
  const { selection } = state
  if (!selection.empty) return null
  const $from = selection.$from
  for (let d = $from.depth; d >= 0; d--) {
    if (BLOCKED_NODES.has($from.node(d).type.name)) return null
  }
  // 行内代码里敲冒号是正文语义（`:smile:` 就是要写字面），不补全
  if (state.schema.marks.inlineCode && $from.marks().some((m) => m.type === state.schema.marks.inlineCode)) {
    return null
  }
  if (!$from.parent.isTextblock) return null
  // 只看光标前 64 字符：够覆盖任何合理前缀，也避免整段取文本
  const start = Math.max(0, $from.parentOffset - 64)
  const textBefore = $from.parent.textBetween(start, $from.parentOffset, undefined, '\uFFFC')
  const m = TRIGGER_RE.exec(textBefore)
  if (!m) return null
  const query = m[1] ?? ''
  const to = $from.pos
  return { from: to - query.length - 1, to, query }
}

/** 前缀 → 候选缓存：每次事务都会调用（含上下键移动），避免反复遍历整份词表 */
const hitsCache = new Map<string, EmojiHit[]>()

function filterItems(query: string): EmojiHit[] {
  const cached = hitsCache.get(query)
  if (cached) return cached
  const needle = ':' + query.toLowerCase()
  const hits: EmojiHit[] = []
  for (const [name, char] of Object.entries(EMOJI_DEFS)) {
    const label = ':' + name
    if (!label.startsWith(needle) && !label.includes(needle)) continue
    hits.push({ name, char: String(char) })
  }
  // 前缀命中优先（`:smile:` 之于 `:smile_cat:`），与源码侧 boost 同语义
  hits.sort((a, b) => {
    const la = ':' + a.name.toLowerCase()
    const lb = ':' + b.name.toLowerCase()
    const sa = la === needle + ':' ? 0 : la.startsWith(needle) ? 1 : 2
    const sb = lb === needle + ':' ? 0 : lb.startsWith(needle) ? 1 : 2
    return sa !== sb ? sa - sb : la.length - lb.length
  })
  const out = hits.slice(0, MAX_ITEMS)
  if (hitsCache.size > 128) hitsCache.clear()
  hitsCache.set(query, out)
  return out
}

function nextState(state: EditorState, prev: EmojiPluginState, tr: import('@milkdown/kit/prose/state').Transaction): EmojiPluginState {
  const closed: EmojiPluginState = {
    open: false,
    from: 0,
    to: 0,
    query: '',
    active: -1,
    dismissedQuery: null
  }
  const ctx = detectContext(state)
  const meta = tr.getMeta(emojiCompletionKey) as EmojiMeta | undefined

  if (!ctx) {
    // 离开触发上下文：Esc 的抑制状态一并作废（下次重新出现要能弹）
    return closed
  }
  if (meta?.dismiss) {
    return { open: false, from: ctx.from, to: ctx.to, query: ctx.query, active: -1, dismissedQuery: ctx.query }
  }
  if (prev.dismissedQuery !== null && prev.dismissedQuery === ctx.query) {
    // Esc 关掉的是同一个前缀：保持关闭，等用户继续输入
    return { open: false, from: ctx.from, to: ctx.to, query: ctx.query, active: -1, dismissedQuery: prev.dismissedQuery }
  }
  const same = prev.open && prev.query === ctx.query
  let active = same ? prev.active : -1
  if (same && meta?.move) {
    const count = filterItems(ctx.query).length
    if (count > 0) {
      active = active < 0 ? (meta.move === 1 ? 0 : count - 1) : (active + meta.move + count) % count
    }
  }
  return { open: true, from: ctx.from, to: ctx.to, query: ctx.query, active, dismissedQuery: null }
}

/** 接受候选项：替换 `:前缀` 为字符，光标落字符之后 */
function accept(view: EditorView, st: EmojiPluginState): boolean {
  const hits = filterItems(st.query)
  if (!hits.length) return false
  const pick = st.active >= 0 && hits[st.active] ? hits[st.active]! : hits[0]!
  const tr = view.state.tr.insertText(pick.char, st.from, st.to)
  tr.setMeta(emojiCompletionKey, { dismiss: true } satisfies EmojiMeta)
  view.dispatch(tr)
  return true
}

export function createEmojiCompletionPlugin(): Plugin<EmojiPluginState> {
  return new Plugin<EmojiPluginState>({
    key: emojiCompletionKey,
    state: {
      init: () => ({ open: false, from: 0, to: 0, query: '', active: -1, dismissedQuery: null }),
      apply: (tr, prev, _old, newState) => nextState(newState, prev, tr)
    },
    /**
     * 键位走 document 捕获阶段而不是 props.handleKeyDown：
     * Milkdown 预设的 keymap 插件注册更早，PM 的 someProp 遇到 Enter 已被
     * splitBlock 认领就短路（实测弹层开着按 Enter 仍落段、候选不被接受）。
     * 捕获阶段先于编辑器自身监听器，stopPropagation 后 PM 不再消费。
     */
    view(editorView) {
      const popup = document.createElement('div')
      popup.className = 'emoji-menu'
      popup.style.display = 'none'
      document.body.appendChild(popup)

      let items: HTMLButtonElement[] = []
      let shownFor = ''

      const hide = (): void => {
        popup.style.display = 'none'
        popup.textContent = ''
        items = []
        shownFor = ''
      }

      const draw = (view: EditorView): void => {
        const st = emojiCompletionKey.getState(view.state)
        if (!st?.open) {
          if (popup.style.display !== 'none') hide()
          return
        }
        const key = st.query + '|' + st.active
        if (key !== shownFor) {
          const hits = filterItems(st.query)
          if (!hits.length) {
            hide()
            return
          }
          popup.textContent = ''
          items = hits.map((hit, i) => {
            const b = document.createElement('button')
            b.type = 'button'
            b.className = 'emoji-menu-item' + (i === st.active ? ' is-active' : '')
            const charEl = document.createElement('span')
            charEl.className = 'emoji-menu-char'
            charEl.textContent = hit.char
            const nameEl = document.createElement('span')
            nameEl.className = 'emoji-menu-name'
            nameEl.textContent = ':' + hit.name + ':'
            b.append(charEl, nameEl)
            b.addEventListener('mousedown', (e) => {
              e.preventDefault()
              // 点击时按当前状态重取（弹层渲染期间文档可能已变）
              const cur = emojiCompletionKey.getState(view.state)
              if (!cur?.open) return
              const h = filterItems(cur.query)[i]
              if (!h) return
              const tr = view.state.tr.insertText(h.char, cur.from, cur.to)
              tr.setMeta(emojiCompletionKey, { dismiss: true } satisfies EmojiMeta)
              view.dispatch(tr)
              view.focus()
            })
            popup.appendChild(b)
            return b
          })
          shownFor = key
        }
        // 定位：光标下方；下方放不下翻到上方
        try {
          const coords = view.coordsAtPos(st.to)
          const w = popup.offsetWidth || 180
          const h = popup.offsetHeight || 200
          let left = coords.left
          left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
          let top = coords.bottom + 6
          if (top + h > window.innerHeight - 8) top = Math.max(8, coords.top - h - 6)
          popup.style.left = `${Math.round(left)}px`
          popup.style.top = `${Math.round(top)}px`
        } catch {
          hide()
          return
        }
        popup.style.display = ''
        const activeEl = items[st.active]
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' })
      }

      const onKeyDown = (event: KeyboardEvent): void => {
        if (!editorView.hasFocus()) return
        const st = emojiCompletionKey.getState(editorView.state)
        if (!st?.open) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          editorView.dispatch(
            editorView.state.tr.setMeta(emojiCompletionKey, { dismiss: true } satisfies EmojiMeta)
          )
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          event.stopPropagation()
          accept(editorView, st)
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          editorView.dispatch(
            editorView.state.tr.setMeta(emojiCompletionKey, {
              move: event.key === 'ArrowDown' ? 1 : -1
            } satisfies EmojiMeta)
          )
        }
      }
      document.addEventListener('keydown', onKeyDown, true)

      // 滚动时弹层会飘在旧位置：直接收起（继续输入会重新弹出）
      const onScroll = (): void => {
        const st = emojiCompletionKey.getState(editorView.state)
        if (st?.open && popup.style.display !== 'none') hide()
      }
      document.addEventListener('scroll', onScroll, true)

      draw(editorView)
      return {
        update: (view) => draw(view),
        destroy: () => {
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('scroll', onScroll, true)
          popup.remove()
          items = []
        }
      }
    }
  })
}
