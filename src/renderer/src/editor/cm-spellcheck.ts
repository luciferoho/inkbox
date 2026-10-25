import { ViewPlugin, ViewUpdate, Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { useUiStore } from '@/stores/ui'
import { findMisspells, spellEngineReady } from '@/services/spellcheck'

/**
 * 源码模式拼写装饰（4.2 自研引擎）：可见范围内错词加红波浪线 mark。
 * 代码围栏/行内码内的词不检查；只在引擎就绪且开关开启时产出。
 * 开关切换经 SourceEditor 的 Compartment 重挂（与 vim/focus 同机制）。
 */

function isInsideFence(view: EditorView, pos: number): boolean {
  let node = syntaxTree(view.state).resolveInner(pos, -1)
  while (node) {
    if (node.name.includes('FencedCode') || node.name.includes('HTMLBlock')) return true
    const parent: typeof node | null = node.parent
    if (!parent) return false
    node = parent
  }
  return false
}

function isInlineCode(view: EditorView, pos: number): boolean {
  let cur: ReturnType<typeof syntaxTree>['resolveInner'] extends (...args: never[]) => infer R ? R : never = syntaxTree(view.state).resolveInner(pos, -1)
  while (cur) {
    if (cur.name.includes('InlineCode')) return true
    const parent: typeof cur | null = cur.parent
    if (!parent) return false
    cur = parent
  }
  return false
}

function buildDecos(view: EditorView): DecorationSet {
  const ui = useUiStore()
  if (!ui.editorPrefs.spellcheck || !spellEngineReady()) return Decoration.none
  const decos: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    const lineStarts: number[] = [0]
    const text = view.state.sliceDoc(from, to)
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
    for (let li = 0; li < lineStarts.length; li++) {
      const lineFrom = from + lineStarts[li]
      const lineTo = li + 1 < lineStarts.length ? from + lineStarts[li + 1] - 1 : to
      if (lineTo <= lineFrom) continue
      if (isInsideFence(view, lineFrom)) continue
      const segText = view.state.sliceDoc(lineFrom, lineTo)
      for (const h of findMisspells(segText)) {
        const abs = lineFrom + h.start
        if (isInlineCode(view, abs)) continue
        decos.push(Decoration.mark({ class: 'spell-err' }).range(abs, lineFrom + h.end))
      }
    }
  }
  return Decoration.set(decos, true)
}

export const cmSpellcheck = ViewPlugin.fromClass(
  class {
    decos: DecorationSet
    constructor(view: EditorView) {
      this.decos = buildDecos(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decos = buildDecos(u.view)
      }
    }
  },
  {
    decorations: (v) => v.decos
  }
)
