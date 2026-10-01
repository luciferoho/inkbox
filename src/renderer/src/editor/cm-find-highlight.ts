import { StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state'
import { ViewPlugin, Decoration, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'
import type { SearchQuery } from '@codemirror/search'

/**
 * 源码/双栏模式的查找命中高亮。
 * 不用 @codemirror/search 自带高亮：它要求搜索面板处于打开状态
 * （highlight() 里 `!panel` 直接返回无装饰），我们用自建查找条驱动
 * setSearchQuery 时面板永远是关的——自己维护一份查询状态 + 视口高亮。
 * 导航/替换仍走 CM 的 findNext/replaceNext 命令（不依赖面板，已验证可用）。
 */

/** 与 setSearchQuery 并行维护的查询状态（专供高亮器读取） */
export const setLuciFindQuery = StateEffect.define<SearchQuery | null>()

const luciFindQueryField = StateField.define<SearchQuery | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLuciFindQuery)) return e.value
    return value
  }
})

const hitMark = Decoration.mark({ class: 'cm-luci-find-hit' })
const activeMark = Decoration.mark({ class: 'cm-luci-find-hit cm-luci-find-hit-active' })

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(setLuciFindQuery)))
      ) {
        this.decorations = this.build(u.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const query = view.state.field(luciFindQueryField, false)
      if (!query || !query.search) return Decoration.none
      const { state } = view
      const sel = state.selection.main
      const builder = new RangeSetBuilder<Decoration>()
      for (const range of view.visibleRanges) {
        let hits: { from: number; to: number }[]
        try {
          const cursor = query.getCursor(state.doc, range.from, range.to)
          hits = []
          for (let r = cursor.next(); !r.done; r = cursor.next()) {
            const h = r.value as { from: number; to: number }
            if (h.to > h.from) hits.push(h)
          }
        } catch {
          return Decoration.none // 非法正则
        }
        for (const h of hits) {
          const active = !sel.empty && h.from >= sel.from && h.to <= sel.to
          builder.add(h.from, h.to, active ? activeMark : hitMark)
        }
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

export function luciFindHighlight(): Extension {
  return [luciFindQueryField, highlighter]
}
