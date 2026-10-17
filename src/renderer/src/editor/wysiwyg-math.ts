import type { Ctx } from '@milkdown/kit/ctx'
import { $inputRule, $nodeSchema, $view } from '@milkdown/kit/utils'
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Transaction
} from '@milkdown/kit/prose/state'
import { EditorView, type Decoration, type NodeView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { keymap } from '@milkdown/kit/prose/keymap'
import { chainCommands, deleteSelection, newlineInCode } from '@milkdown/kit/prose/commands'
import { StepMap } from '@milkdown/kit/prose/transform'

/**
 * 即显 KaTeX 数学（ROADMAP 1.1）：行内 $...$ / 块级 $$...$$。
 *
 * 设计沿用 prosemirror-math（MIT）的嵌套视图方案：
 * - 节点为 atom + content("text*")：外层视图把公式当整体跳光标，点击产生
 *   NodeSelection → selectNode 开一个嵌套 EditorView 编辑 TeX 源码；
 * - 嵌套视图事务经 StepMap.offset(pos+1) 映射回外层（撤销/更新/监听全走外层）；
 * - 未编辑态用 KaTeX 渲染（懒加载，与预览管线共用同一模块实例与 CSS）；
 * - 解析/序列化走 remark-math（mdast inlineMath/math）⇄ mdast-util-math，
 *   磁盘上的 $ 语法无损往返。
 */

/* ---------- KaTeX 懒加载（与 services/markdown.ts 同一模块缓存） ---------- */

type KatexModule = typeof import('katex')
let katexMod: KatexModule | null = null
let katexLoading: Promise<KatexModule | null> | null = null

function ensureKatex(): Promise<KatexModule | null> {
  if (katexMod) return Promise.resolve(katexMod)
  katexLoading ??= import('katex')
    .then((m) => {
      katexMod = (m.default ?? m) as KatexModule
      return katexMod
    })
    .catch(() => null)
  return katexLoading
}

function renderKatex(tex: string, displayMode: boolean): string {
  if (!katexMod) return ''
  return katexMod.renderToString(tex, {
    displayMode,
    throwOnError: false,
    strict: false,
    trust: false,
    globalGroup: true
  })
}

/* ---------- 节点 schema ---------- */

export const mathInlineSchema = $nodeSchema('math_inline', () => ({
  group: 'inline math',
  content: 'text*',
  inline: true,
  atom: true,
  toDOM: () => ['math-inline', { class: 'luci-math' }, 0],
  parseDOM: [{ tag: 'math-inline' }],
  parseMarkdown: {
    match: ({ type }) => type === 'inlineMath',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(String(node.value))
      state.closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => {
      // 空公式序列化成 `$ $`（mdast-util-math 对空值的行为与解析端对齐）
      state.addNode('inlineMath', undefined, node.textContent || ' ')
    }
  }
}))

export const mathBlockSchema = $nodeSchema('math_block', () => ({
  content: 'text*',
  group: 'block math',
  atom: true,
  code: true, // 嵌套视图里 newlineInCode 依赖此标记；外层 inCodeBlock 按 code_block 名判断
  defining: true,
  toDOM: () => ['math-block', { class: 'luci-math' }, 0],
  parseDOM: [{ tag: 'math-block', preserveWhitespace: 'full' }],
  parseMarkdown: {
    match: ({ type }) => type === 'math',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(String(node.value))
      state.closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => {
      state.addNode('math', undefined, node.textContent)
    }
  }
}))

/* ---------- 节点视图：KaTeX 渲染 ⇄ 嵌套源码编辑 ---------- */

class MathNodeView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private outerView: EditorView
  private getPos: () => number | undefined
  private inline: boolean
  private renderElt: HTMLElement
  private srcElt: HTMLElement
  private innerView: EditorView | null = null
  private editing = false

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    _decorations: readonly Decoration[],
    inline: boolean
  ) {
    this.node = node
    this.outerView = view
    this.getPos = getPos
    this.inline = inline

    this.dom = document.createElement(inline ? 'math-inline' : 'math-block')
    this.dom.classList.add('luci-math')

    this.renderElt = document.createElement('span')
    this.renderElt.classList.add('luci-math-render')
    this.srcElt = document.createElement('span')
    this.srcElt.classList.add('luci-math-src')
    this.srcElt.setAttribute('spellcheck', 'false')
    this.dom.append(this.renderElt, this.srcElt)

    // 点击公式任意处：嵌套视图已开时把焦点拉回（防止误删整块）
    this.dom.addEventListener('mousedown', this.onMouseDown)

    this.renderMath()
    if (!katexMod) void ensureKatex().then((ok) => ok && !this.editing && this.renderMath())
  }

  private onMouseDown = (): void => {
    if (this.innerView && this.outerView.hasFocus()) this.innerView.focus()
  }

  destroy(): void {
    this.closeEditor(false)
  }

  update(node: PMNode): boolean {
    if (!node.sameMarkup(this.node)) return false
    this.node = node

    // 外层文档变化（撤销/替换/外部同步）→ 同步进嵌套视图
    if (this.innerView) {
      const state = this.innerView.state
      const start = node.content.findDiffStart(state.doc.content)
      if (start != null) {
        const diff = node.content.findDiffEnd(state.doc.content)
        if (diff) {
          let { a: endA, b: endB } = diff
          const overlap = start - Math.min(endA, endB)
          if (overlap > 0) {
            endA += overlap
            endB += overlap
          }
          this.innerView.dispatch(
            state.tr
              .replace(start, endB, node.slice(start, endA))
              .setMeta('fromOutside', true)
          )
        }
      }
    }

    // 编辑中保持源码态不闪渲染
    if (!this.editing) this.renderMath()
    return true
  }

  selectNode(): void {
    if (!this.outerView.editable) return
    this.dom.classList.add('luci-math--editing')
    if (!this.editing) this.openEditor()
  }

  deselectNode(): void {
    this.dom.classList.remove('luci-math--editing')
    if (this.editing) this.closeEditor(true)
  }

  stopEvent(event: Event): boolean {
    return (
      this.innerView !== null &&
      event.target instanceof Node &&
      this.innerView.dom.contains(event.target)
    )
  }

  ignoreMutation(): boolean {
    // 内容 DOM 完全由嵌套视图管理，外层忽略一切突变
    return true
  }

  /* ---------- 渲染 ---------- */

  private renderMath(): void {
    const tex = this.node.textContent.trim()
    if (!tex) {
      this.dom.classList.add('luci-math-empty')
      this.renderElt.textContent = ''
      return
    }
    this.dom.classList.remove('luci-math-empty')
    if (!katexMod) {
      // katex 尚未就绪：先显示 TeX 源码占位，加载完成后重渲染
      this.renderElt.classList.add('luci-math-pending')
      this.renderElt.textContent = this.inline ? `$${tex}$` : tex
      return
    }
    this.renderElt.classList.remove('luci-math-pending')
    this.renderElt.innerHTML = renderKatex(tex, !this.inline)
  }

  /* ---------- 嵌套源码编辑视图 ---------- */

  private dispatchInner = (tr: Transaction): void => {
    if (!this.innerView) return
    const state = this.innerView.state
    this.innerView.updateState(state.apply(tr))
    if (tr.getMeta('fromOutside')) return
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    // 内层步骤映射到外层文档（+1 越过节点入口），历史/监听全在外层生效
    const outerTr = this.outerView.state.tr
    const offsetMap = StepMap.offset(pos + 1)
    for (const step of tr.steps) {
      const mapped = step.map(offsetMap)
      if (!mapped) break
      outerTr.step(mapped)
    }
    if (outerTr.docChanged) this.outerView.dispatch(outerTr)
  }

  private openEditor(): void {
    if (this.innerView) return
    this.innerView = new EditorView(this.srcElt, {
      state: EditorState.create({
        doc: this.node,
        plugins: [
          keymap({
            Tab: (state, dispatch) => {
              if (dispatch) dispatch(state.tr.insertText('\t'))
              return true
            },
            Backspace: chainCommands(deleteSelection, (state) => {
              if (!state.selection.empty) return false
              // 公式已空：删掉整个节点，焦点回外层
              if (this.node.textContent.length > 0) return false
              this.deleteSelf()
              return true
            }),
            'Mod-Backspace': () => {
              this.deleteSelf()
              return true
            },
            Enter:
              this.inline
                ? () => this.collapse(1)
                : chainCommands(newlineInCode, () => this.collapse(1)),
            Escape: () => this.collapse(1),
            ArrowLeft: (state) => (state.selection.from <= 0 ? this.collapse(-1) : false),
            ArrowUp: (state) => (state.selection.from <= 0 ? this.collapse(-1) : false),
            ArrowRight: (state) =>
              state.selection.to >= state.doc.content.size ? this.collapse(1) : false,
            ArrowDown: (state) =>
              state.selection.to >= state.doc.content.size ? this.collapse(1) : false
          })
        ]
      }),
      dispatchTransaction: this.dispatchInner
    })
    this.innerView.focus()
    this.editing = true
    // 光标落 TeX 末尾。focus() 后 Chromium 会把 DOM 光标放到起点，selectionchange
    // 会把起点反向同步进模型——同步放一次 + 宏任务后再放一次，两种时序都收敛到末尾。
    // 注意节点作为 doc 时合法位置是 0..content.size（终点即 content.size，+1 会越界）
    const placeCaret = (): void => {
      if (!this.innerView || !this.editing) return
      const st = this.innerView.state
      this.innerView.dispatch(
        st.tr.setSelection(TextSelection.create(st.doc, st.doc.content.size))
      )
    }
    placeCaret()
    window.setTimeout(placeCaret, 0)
  }

  private closeEditor(render: boolean): void {
    if (this.innerView) {
      this.innerView.destroy()
      this.innerView = null
      // PM 的 destroy 不摘除自己挂载的 dom，残留会污染下次 openEditor 的挂载点
      this.srcElt.textContent = ''
    }
    if (render) this.renderMath()
    this.editing = false
  }

  private deleteSelf(): void {
    const pos = this.getPos()
    this.closeEditor(false)
    if (typeof pos !== 'number') return
    const size = this.node.nodeSize
    this.outerView.dispatch(this.outerView.state.tr.delete(pos, pos + size))
    this.outerView.focus()
  }

  /** 关闭编辑并把外层光标挪到公式前/后（Esc、方向键到边界、行内公式回车） */
  private collapse(dir: 1 | -1): boolean {
    const pos = this.getPos()
    const size = this.node.nodeSize
    this.closeEditor(true)
    if (typeof pos !== 'number') return false
    const doc = this.outerView.state.doc
    const target = Math.max(0, Math.min(dir === 1 ? pos + size : pos, doc.content.size))
    this.outerView.dispatch(
      this.outerView.state.tr.setSelection(TextSelection.near(doc.resolve(target), dir))
    )
    this.outerView.focus()
    return true
  }
}

export const mathInlineView = $view(mathInlineSchema.node, () => (node, view, getPos, decorations) =>
  new MathNodeView(node, view, getPos, decorations, true)
)
export const mathBlockView = $view(mathBlockSchema.node, () => (node, view, getPos, decorations) =>
  new MathNodeView(node, view, getPos, decorations, false)
)

/* ---------- 输入规则 ---------- */

/** 内容不能以空白开头/结尾（与 micromark math 语法一致，防货币 `$ 5 $` 误判） */
function badTexContent(s: string): boolean {
  return /^\s|\s$/.test(s)
}/** `$x$` → 行内公式（支持 \$ 转义排除，Chromium 原生支持 lookbehind） */
export const inlineMathInputRule = $inputRule((ctx: Ctx) => {
  return new InputRule(/(?<!\\)\$([^$\n]+)\$$/, (state, match, start, end) => {
    const content = match[1]
    if (badTexContent(content)) return null
    const type = mathInlineSchema.type(ctx)
    const $start = state.doc.resolve(start)
    if (!$start.parent.canReplaceWith($start.index(), state.doc.resolve(end).index(), type)) {
      return null
    }
    // match[0] 含前缀（行首或一个非 $ 字符），只替换 `$...$` 部分
    const from = start + match[0].length - content.length - 2
    return state.tr.replaceRangeWith(from, end, type.create(null, type.schema.text(content)))
  })
})

/** 段落内 `$$x$$` → 块级公式（整段替换，选中进入编辑态） */
export const blockMathInputRule = $inputRule((ctx: Ctx) => {
  return new InputRule(/\$\$([^$\n]+)\$\$$/, (state, match, start, _end) => {
    const content = match[1]
    if (badTexContent(content)) return null
    const type = mathBlockSchema.type(ctx)
    const $start = state.doc.resolve(start)
    const paraFrom = $start.before()
    const tr = state.tr.replaceWith(paraFrom, $start.after(), type.create(null, type.schema.text(content)))
    return tr.setSelection(NodeSelection.create(tr.doc, paraFrom))
  })
})

/* ---------- 误判护栏（remark 后处理） ---------- */

interface MdastMathNode {
  type?: string
  value?: unknown
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: MdastMathNode[]
}

/**
 * remark-math 的配对比预览管线宽松：`$ 符号与 $`（内容含空格）、行内 `$$x$$`
 * 这类写法在 markdown-it 预览侧按字面处理，micromark 却会配成公式——
 * 两管线显示不一致，序列化还会把值 trim 掉（`$ 符号与 $` → `$符号与$`，源码被改）。
 * 此变换器在解析后按预览管线同一套护栏检查 math 节点，不合格的用
 * 原文位置切片还原为字面文本，保证 roundtrip 逐字节无损。
 */
export function guardMathText() {
  return (tree: MdastMathNode, file?: { value?: unknown }): void => {
    const src = typeof file?.value === 'string' ? file.value : String(file?.value ?? '')
    const walk = (node: MdastMathNode): void => {
      if (!node.children) return
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i]
        if ((c.type === 'inlineMath' || c.type === 'math') && rejectedByGuard(c, src)) {
          const start = c.position?.start?.offset
          const end = c.position?.end?.offset
          if (start != null && end != null && end > start) {
            node.children[i] = { type: 'text', value: src.slice(start, end) }
            continue
          }
        }
        walk(c)
      }
    }
    walk(tree)
  }
}

/** 与预览管线（markdown.ts 行内 $ 规则）同一套护栏。
 *  注意查原文切片而非 node.value：remark-math 解析时已把内容 trim，
 *  `$ 符号与 $` 的 value 是 "符号与"，仅看 value 会漏放行 */
function rejectedByGuard(node: MdastMathNode, src: string): boolean {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start == null || end == null) return false
  const raw = src.slice(start, end)
  if (node.type === 'inlineMath') {
    const first = raw.indexOf('$')
    const last = raw.lastIndexOf('$')
    if (first < 0 || last <= first) return false
    if (raw.startsWith('$$')) return true // 行内 $$..$$：预览按字面
    const inner = raw.slice(first + 1, last)
    return !inner.trim() || /^\s|\s$/.test(inner)
  }
  return false // 块级 flow math 行首锚定，两侧一致
}
