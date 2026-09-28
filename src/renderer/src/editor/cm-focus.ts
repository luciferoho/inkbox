import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

/**
 * 专注模式：淡出光标所在段落（空行分隔的块）之外的所有可见行。
 * 只装饰当前视口内的行，长文档无压力。
 */
const dimLine = Decoration.line({ class: 'cm-dim-line' })

function buildDimDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const head = view.state.selection.main.head

  let startLine = doc.lineAt(head).number
  let endLine = startLine
  while (startLine > 1 && doc.line(startLine - 1).text.trim() !== '') startLine--
  while (endLine < doc.lines && doc.line(endLine + 1).text.trim() !== '') endLine++

  const builder = new RangeSetBuilder<Decoration>()
  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = doc.lineAt(pos)
      if (line.number < startLine || line.number > endLine) {
        builder.add(line.from, line.from, dimLine)
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const focusDimPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDimDecorations(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDimDecorations(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

export const luciFocusMode = [
  focusDimPlugin,
  EditorView.theme({
    '.cm-dim-line': {
      opacity: '0.35',
      transition: 'opacity 0.25s ease'
    }
  })
]

/** 打字机模式：光标移动/输入时保持当前行处于视口中部（scrollIntoView 已居中则不动） */
export const luciTypewriterMode = EditorView.updateListener.of((u) => {
  if (!(u.docChanged || u.selectionSet) || !u.view.hasFocus) return
  const pos = u.state.selection.main.head
  u.view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: 'center' })
  })
})
