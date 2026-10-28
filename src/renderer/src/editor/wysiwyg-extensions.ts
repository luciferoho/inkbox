import { $inputRule, $markSchema, $nodeSchema, $prose, $view } from '@milkdown/kit/utils'
import { markRule } from '@milkdown/kit/prose'
import type { Ctx } from '@milkdown/kit/ctx'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { EditorState, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/kit/prose/view'
import type { Mark, Node as PMNode } from '@milkdown/kit/prose/model'
import remarkGemoji from 'remark-gemoji'
import remarkFootnotes from 'remark-footnotes'
import remarkFrontmatter from 'remark-frontmatter'
import { sanitizeHtmlTableBlock, rewriteHtmlImgSrc } from '@/services/markdown'

/**
 * 即显扩展语法（ROADMAP 1.3/1.4/1.5）：==高亮==、^上标^、~下标~、脚注、emoji。
 *
 * - emoji：remark-gemoji 在解析期把 `:smile:` 替换为 emoji 字符（纯文本替换，
 *   无需 schema；与预览管线 markdown-it-emoji 的行为一致，序列化保持字符）。
 * - 高亮/上下标：remark 生态无统一包，自写后处理 transformer——遍历文本节点
 *   按 markdown-it-mark/sub/sup 同一套边界规则切分，产出自定义 mdast 节点
 *   （markHighlight/markSuperscript/markSubscript），由下方 mark schema 接住；
 *   序列化经 withMark 产出同名 mdast 节点，由 WysiwygEditor 注册的
 *   remarkStringify handlers 还原为 ==text== 语法。
 * - 脚注：remark-footnotes 产出 footnoteReference/footnoteDefinition 节点，
 *   schema 仅做映射；序列化由 remark-footnotes 在 processor 上的 toMarkdown
 *   扩展原生处理。
 */

/* ---------- 1.3 高亮/上下标：文本切分 transformer ---------- */

interface MdastInlineNode {
  type?: string
  value?: unknown
  tag?: unknown
  position?: { start?: { offset?: number }; end?: { offset?: number } }
  children?: MdastInlineNode[]
}

/** 内容两侧不得贴空白（与 markdown-it-mark/sub/sup 同一规则，防 `a == b == c` 误判） */
const HL_RE = /==([^=\s][^=\n]*[^=\s]|[^=\s])==/g
const SUP_RE = /\^([^\^\s][^^\n]*[^\^\s]|[^\^\s])\^/g
const SUB_RE = /~([^~\s][^~\n]*[^~\s]|[^~\s])~/g

type MarkKind = 'markHighlight' | 'markSuperscript' | 'markSubscript'

function splitTextByRe(
  value: string,
  re: RegExp,
  kind: MarkKind,
  out: MdastInlineNode[]
): void {
  let last = 0
  re.lastIndex = 0
  for (let m = re.exec(value); m !== null; m = re.exec(value)) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    out.push({ type: kind, children: [{ type: 'text', value: m[1] }] })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
}

function applyInlineMarks(text: MdastInlineNode): MdastInlineNode[] | null {
  const value = String(text.value ?? '')
  if (!value) return null
  let parts: MdastInlineNode[] | null = null
  const feed = (re: RegExp, kind: MarkKind): void => {
    if (!parts) return
    const next: MdastInlineNode[] = []
    for (const p of parts) {
      if (p.type === 'text') splitTextByRe(String(p.value ?? ''), re, kind, next)
      else next.push(p)
    }
    parts = next
  }
  parts = [{ type: 'text', value }]
  feed(HL_RE, 'markHighlight')
  feed(SUP_RE, 'markSuperscript')
  feed(SUB_RE, 'markSubscript')
  const changed =
    parts!.length !== 1 || parts![0].type !== 'text' || parts![0].value !== text.value
  return changed ? parts! : null
}

/** 解析后处理：把文本里的 ==x== / ^x^ / ~x~ 切成自定义节点（跳过代码/公式子树）。
 *  另处理 GFM 单波浪删除线：remark-gfm 默认把 `~x~` 也配成 delete，而本应用
 *  两条管线（markdown-it-sub + Typora 语义）里 `~x~` 是下标——按原文切片判定，
 *  单波浪的 delete 改写为 markSubscript（双波浪的真删除线不受影响） */
export function splitInlineMarks(): (tree: MdastInlineNode, file?: { value?: unknown }) => void {
  const SKIP = new Set(['code', 'inlineCode', 'math', 'inlineMath'])
  const walk = (node: MdastInlineNode, src: string): void => {
    if (!node.children) return
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i]
      if (SKIP.has(c.type ?? '')) continue
      if (c.type === 'delete' && isSingleTilde(c, src)) {
        node.children[i] = { type: 'markSubscript', children: c.children }
        walk(node.children[i] as MdastInlineNode, src)
        continue
      }
      if (c.type === 'text') {
        const parts = applyInlineMarks(c)
        if (parts) {
          node.children.splice(i, 1, ...parts)
          i += parts.length - 1
          continue
        }
      }
      walk(c, src)
    }
  }
  return (tree, file) => {
    const src = typeof file?.value === 'string' ? file.value : String(file?.value ?? '')
    walk(tree, src)
  }
}

/** delete 节点是否由单个 ~ 包裹（原文切片判定） */
function isSingleTilde(node: MdastInlineNode, src: string): boolean {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (start == null || end == null) return false
  const raw = src.slice(start, end)
  return raw.startsWith('~') && !raw.startsWith('~~') && raw.endsWith('~') && !raw.endsWith('~~')
}

/* ---------- 1.3 mark schemas ---------- */

interface MarkSchemaOpts {
  name: string
  mdastType: MarkKind
  tag: string
}

function makeInlineMarkSchema(opts: MarkSchemaOpts) {
  return $markSchema(opts.name, (ctx) => ({
    parseDOM: [{ tag: opts.tag }],
    toDOM: () => [opts.tag, {}],
    parseMarkdown: {
      match: ({ type }) => type === opts.mdastType,
      runner: (state, node, markType) => {
        state.openMark(markType)
        state.addText(String(node.children?.[0]?.value ?? ''))
        state.closeMark(markType)
      }
    },
    toMarkdown: {
      match: (node) => node.type.name === opts.name,
      runner: (state, mark, node) => {
        state.withMark(mark, opts.mdastType, node.text ?? '')
      }
    }
  }))
}

export const highlightSchema = makeInlineMarkSchema({ name: 'mark', mdastType: 'markHighlight', tag: 'mark' })
export const superscriptSchema = makeInlineMarkSchema({ name: 'superscript', mdastType: 'markSuperscript', tag: 'sup' })
export const subscriptSchema = makeInlineMarkSchema({ name: 'subscript', mdastType: 'markSubscript', tag: 'sub' })

/** 序列化 handlers：withMark 产出的自定义 mdast 节点还原为 ==/^/~ 语法；
 *  htmlSpan 还原为白名单标签对；yaml 节点还原为 --- 围栏
 *  （挂到 WysiwygEditor 的 remarkStringifyOptionsCtx） */
function mdastTextOf(node: unknown): string {
  const walk = (n: unknown): string => {
    if (typeof n !== 'object' || n === null) return ''
    const o = n as { type?: string; value?: unknown; children?: unknown[] }
    if (o.type === 'text') return String(o.value ?? '')
    return (o.children ?? []).map(walk).join('')
  }
  return walk(node)
}

export const inlineMarkStringifyHandlers = {
  markHighlight: (node: { value?: unknown }) => `==${String(node.value ?? '')}==`,
  markSuperscript: (node: { value?: unknown }) => `^${String(node.value ?? '')}^`,
  markSubscript: (node: { value?: unknown }) => `~${String(node.value ?? '')}~`,
  htmlSpan: (node: { tag?: unknown; children?: unknown[] }) => {
    const tag = String(node.tag ?? 'span')
    return `<${tag}>${mdastTextOf(node)}</${tag}>`
  },
  yaml: (node: { value?: unknown }) => `---\n${String(node.value ?? '')}\n---`
}

/** 输入规则：==x== / ^x^ / ~x~ 打完闭合符即变格式 */
export const highlightInputRule = $inputRule((ctx: Ctx) =>
  markRule(/(?:==)([^=\n]+)(?:==)$/, highlightSchema.type(ctx))
)
export const superscriptInputRule = $inputRule((ctx: Ctx) =>
  markRule(/(?:\^)([^\^\n]+)(?:\^)$/, superscriptSchema.type(ctx))
)
export const subscriptInputRule = $inputRule((ctx: Ctx) =>
  markRule(/(?:~)([^~\n]+)(?:~)$/, subscriptSchema.type(ctx))
)

/* ---------- 1.4 脚注 schemas ---------- */

export const footnoteReferenceSchema = $nodeSchema('footnote_reference', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    identifier: { default: '', validate: 'string' },
    label: { default: '', validate: 'string' }
  },
  toDOM: (node: PMNode) => [
    'sup',
    { class: 'footnote-ref', 'data-id': String(node.attrs.identifier ?? '') },
    // 角标显示纯编号（与预览管线 markdown-it-footnote 一致；此前显示 [^1] 带语法，切模式跳变）
    `[${String(node.attrs.label || node.attrs.identifier || '')}]`
  ],
  parseDOM: [
    {
      tag: 'sup.footnote-ref',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return {}
        // 角标文案是 [1] 展示形态，label 回读要去掉括号（label 进序列化，写 [^label]）
        const text = (dom.textContent ?? '').replace(/[[\]^]/g, '')
        return { identifier: dom.dataset.id ?? '', label: text }
      }
    }
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'footnoteReference',
    runner: (state, node, type) => {
      state.openNode(type, {
        identifier: String(node.identifier ?? ''),
        label: String(node.label ?? node.identifier ?? '')
      })
      state.closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'footnote_reference',
    runner: (state, node) => {
      state.addNode('footnoteReference', undefined, undefined, {
        identifier: String(node.attrs.identifier ?? ''),
        label: String(node.attrs.label ?? '')
      })
    }
  }
}))

export const footnoteDefinitionSchema = $nodeSchema('footnote_definition', () => ({
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: { identifier: { default: '', validate: 'string' } },
  toDOM: (node: PMNode) => [
    'div',
    { class: 'footnote-def', 'data-id': String(node.attrs.identifier ?? '') },
    0
  ],
  parseDOM: [
    {
      tag: 'div.footnote-def',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return {}
        return { identifier: dom.dataset.id ?? '' }
      }
    }
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'footnoteDefinition',
    runner: (state, node, type) => {
      state.openNode(type, { identifier: String(node.identifier ?? '') }).next(node.children).closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'footnote_definition',
    runner: (state, node) => {
      state.openNode('footnoteDefinition', undefined, { identifier: String(node.attrs.identifier ?? '') })
        .next(node.content)
        .closeNode()
    }
  }
}))

/** 输入规则：[^1] 打完即变脚注引用（定义仍需手工在文末补） */
export const footnoteReferenceInputRule = $inputRule((ctx: Ctx) => {
  const type = footnoteReferenceSchema.type(ctx)
  return new InputRule(/\[\^([^\^\s\]]+)\]$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start)
    if (!$start.parent.canReplaceWith($start.index(), state.doc.resolve(end).index(), type)) return null
    return state.tr.replaceRangeWith(
      start,
      end,
      type.create({ identifier: match[1], label: match[1] })
    )
  })
})

/* ---------- 1.9 行内 HTML 白名单 ---------- */

const HTML_WL_TAGS = new Set(['u', 'mark', 'sub', 'sup', 'kbd', 'b', 'strong', 'i', 'em', 's', 'del'])
const HTML_OPEN_RE = /^<([a-z]+)(?:\s[^>]*)?\/?>$/i
const HTML_CLOSE_RE = /^<\/([a-z]+)\s*>$/i
const HTML_BR_RE = /^<br\s*\/?>$/i

function whitelistOpenTag(value: string): string | null {
  const m = HTML_OPEN_RE.exec(value)
  const tag = m?.[1]?.toLowerCase() ?? null
  return tag && HTML_WL_TAGS.has(tag) ? tag : null
}

function whitelistCloseTag(value: string): string | null {
  const m = HTML_CLOSE_RE.exec(value)
  const tag = m?.[1]?.toLowerCase() ?? null
  return tag && HTML_WL_TAGS.has(tag) ? tag : null
}

/** 同层配对：<tag>...</tag> 的 html 节点序列 → htmlSpan 节点（children 递归处理，
 *  支持嵌套不同标签）；<br> → break；未配对/非白名单保持 html 原子（字面展示） */
function processHtmlInlineList(children: MdastInlineNode[]): MdastInlineNode[] {
  const out: MdastInlineNode[] = []
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (c.type === 'html' && HTML_BR_RE.test(String(c.value ?? ''))) {
      out.push({ type: 'break' })
      continue
    }
    const openTag = c.type === 'html' ? whitelistOpenTag(String(c.value ?? '')) : null
    if (openTag) {
      let close = -1
      for (let k = i + 1; k < children.length; k++) {
        const n = children[k]
        if (n.type !== 'html') continue
        const v = String(n.value ?? '')
        if (whitelistCloseTag(v) === openTag) {
          close = k
          break
        }
        if (whitelistOpenTag(v)) break // 出现新的同层开放标签：保守放弃配对
      }
      if (close > i) {
        out.push({ type: 'htmlSpan', tag: openTag, children: processHtmlInlineList(children.slice(i + 1, close)) })
        i = close
        continue
      }
    }
    if (c.children) {
      c.children = processHtmlInlineList(c.children)
      out.push(c)
      continue
    }
    out.push(c)
  }
  return out
}

export function mergeHtmlSpans(): (tree: MdastInlineNode) => void {
  const walk = (node: MdastInlineNode): void => {
    if (!node.children) return
    node.children = processHtmlInlineList(node.children)
    node.children.forEach((c) => walk(c))
  }
  return (tree) => walk(tree)
}

/** 白名单标签的通用 mark：attrs.tag 决定渲染标签（u/mark/kbd/...） */
export const htmlSpanSchema = $markSchema('html_span', () => ({
  attrs: { tag: { default: 'span', validate: 'string' } },
  parseDOM: [{ tag: 'span[data-html-tag]', getAttrs: (dom) => ({ tag: dom instanceof HTMLElement ? dom.dataset.htmlTag ?? 'span' : 'span' }) }],
  toDOM: (mark) => [String(mark.attrs.tag ?? 'span'), { 'data-html-tag': String(mark.attrs.tag ?? '') }],
  parseMarkdown: {
    match: ({ type }) => type === 'htmlSpan',
    runner: (state, node, markType) => {
      state.openMark(markType, { tag: String(node.tag ?? 'span') })
      state.next(node.children)
      state.closeMark(markType)
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'html_span',
    runner: (state, mark) => {
      state.withMark(mark, 'htmlSpan', void 0, { tag: String(mark.attrs.tag ?? 'span') })
    }
  }
}))

/* ---------- 1.7 YAML front matter ---------- */

export const yamlSchema = $nodeSchema('yaml', () => ({
  content: 'text*',
  group: 'block',
  code: true,
  defining: true,
  toDOM: () => ['div', { class: 'fm-block' }, 0],
  parseDOM: [{ tag: 'div.fm-block', preserveWhitespace: 'full' }],
  parseMarkdown: {
    match: ({ type }) => type === 'yaml',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(String(node.value))
      state.closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'yaml',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent)
    }
  }
}))

/* ---------- 1.6 [TOC] ---------- */

/** 独占一段的 [TOC]（大小写不限）→ toc 块节点（transformer 改写，避免与
 *  内置 paragraph schema 竞争匹配） */
export function tocBlock(): (tree: MdastInlineNode) => void {
  const walk = (node: MdastInlineNode): void => {
    if (!node.children) return
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i]
      if (
        c.type === 'paragraph' &&
        c.children?.length === 1 &&
        c.children[0].type === 'text' &&
        /^\s*\[TOC\]\s*$/i.test(String(c.children[0].value ?? ''))
      ) {
        node.children[i] = { type: 'toc' }
        continue
      }
      walk(c)
    }
  }
  return (tree) => walk(tree)
}

export const tocSchema = $nodeSchema('toc', () => ({
  group: 'block',
  atom: true,
  defining: true,
  toDOM: () => ['nav', { class: 'luci-toc' }, 0],
  parseDOM: [{ tag: 'nav.luci-toc' }],
  parseMarkdown: {
    match: ({ type }) => type === 'toc',
    runner: (state, _node, type) => {
      state.openNode(type)
      state.closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'toc',
    runner: (state) => {
      // 走 inline html 节点输出裸文本：remark-stringify 对 text 里的 `[` 会转义成
      // `\[TOC]`（下次保存源码就被污染），html 节点原样通过
      state.openNode('paragraph')
      state.addNode('html', undefined, '[TOC]')
      state.closeNode()
    }
  }
}))

/** [TOC] 视图：从当前文档实时收集标题（1-3 级）渲染嵌套目录，点击跳转对应标题 */
const liveTocViews = new Set<TocNodeView>()

class TocNodeView implements NodeView {
  dom: HTMLElement
  private view: EditorView
  private lastDoc: PMNode | null = null

  constructor(view: EditorView) {
    this.view = view
    this.dom = document.createElement('nav')
    this.dom.className = 'luci-toc'
    this.dom.addEventListener('click', this.onClick)
    liveTocViews.add(this)
    this.render()
  }

  private collect(): { level: number; text: string; pos: number }[] {
    const out: { level: number; text: string; pos: number }[] = []
    this.view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = Number(node.attrs.level ?? 1)
        if (level <= 3) out.push({ level, text: node.textContent, pos })
      }
      return true
    })
    return out
  }

  private render(): void {
    const headings = this.collect()
    this.dom.textContent = ''
    const title = document.createElement('p')
    title.className = 'luci-toc-title'
    title.textContent = '目录'
    this.dom.appendChild(title)
    if (headings.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'luci-toc-empty'
      empty.textContent = '（暂无标题）'
      this.dom.appendChild(empty)
      return
    }
    let i = 0
    const buildLevel = (level: number): HTMLUListElement => {
      const ul = document.createElement('ul')
      while (i < headings.length && headings[i].level >= level) {
        if (headings[i].level === level) {
          const h = headings[i++]
          const li = document.createElement('li')
          const a = document.createElement('a')
          a.href = 'javascript:'
          a.textContent = h.text || '（空标题）'
          a.dataset.pos = String(h.pos)
          li.appendChild(a)
          if (i < headings.length && headings[i].level > level) li.appendChild(buildLevel(level + 1))
          ul.appendChild(li)
        } else {
          ul.appendChild(buildLevel(level + 1)) // 跳级标题归入更深层
        }
      }
      return ul
    }
    this.dom.appendChild(buildLevel(headings[0].level))
  }

  private onClick = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement | null)?.closest('a[data-pos]')
    if (!(a instanceof HTMLAnchorElement)) return
    e.preventDefault()
    const pos = Number(a.dataset.pos)
    const doc = this.view.state.doc
    if (!Number.isFinite(pos) || pos >= doc.content.size) return
    const view = this.view
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))))
    // domAtPos 返回容器+偏移（可能是文本节点），收敛到最近的元素再滚
    const at = view.domAtPos(pos)
    const coerceEl = (n: Node | null | undefined): Element | null => {
      let cur: Node | null = n ?? null
      while (cur && !(cur instanceof Element)) cur = cur.parentNode
      return cur instanceof Element ? cur : null
    }
    const child = at.node instanceof Element ? ((at.node.childNodes[at.offset] as Node | undefined) ?? null) : null
    const el = coerceEl(child ?? at.node)
    ;(el ?? view.dom).scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  update(_node: PMNode): boolean {
    this.refresh()
    return true
  }

  /** doc 任意变化都重投影（标题增删改不影响 toc 节点自身，靠插件驱动） */
  refresh(): void {
    if (this.lastDoc !== this.view.state.doc) {
      this.lastDoc = this.view.state.doc
      this.render()
    }
  }

  ignoreMutation(_m: ViewMutationRecord): boolean {
    return true // 目录是纯投影，突变一律忽略（重渲染由 update 驱动）
  }

  destroy(): void {
    liveTocViews.delete(this)
    this.dom.removeEventListener('click', this.onClick)
  }
}

export const tocView = $view(tocSchema.node, () => (node, view) => new TocNodeView(view))

/** doc 变化 → 所有 [TOC] 视图重投影 */
export const tocUpdatePlugin = $prose(() =>
  new Plugin({
    key: new PluginKey<unknown>('luci-toc-sync'),
    view: (view) => ({
      update: (v: EditorView, prevState: EditorState) => {
        if (v.state.doc === prevState.doc) return
        for (const t of liveTocViews) t.refresh()
      }
    })
  })
)

/* ---------- 块级 HTML 表格白名单（与预览管线 markdown.ts 同一套净化规则） ---------- */

interface MdastBlockNode {
  type?: string
  value?: unknown
  children?: MdastBlockNode[]
}

/** 完整表格块的 html 节点（首行 <table…>、末行 </table>）→ htmlTable 原子节点。
 *  序列化原样还原原始 HTML（字节不变 → 不脏）；渲染在视图里净化后投影 */
export function htmlTableBlock(): (tree: MdastBlockNode) => void {
  const walk = (node: MdastBlockNode): void => {
    if (!node.children) return
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i]
      if (c.type === 'html' && isTableBlockSource(String(c.value ?? ''))) {
        node.children[i] = { type: 'htmlTable', value: String(c.value ?? '').trim() }
        continue
      }
      walk(c)
    }
  }
  return (tree) => walk(tree)
}

function isTableBlockSource(value: string): boolean {
  const t = value.trim()
  return /^<table(\s[^<>]*)?>/i.test(t) && /<\/table>$/i.test(t)
}

export const htmlTableSchema = $nodeSchema('html_table', () => ({
  // Typora 语义：HTML 块默认渲染成结果，光标进入后才显示源码（可改）。
  // 节点存原始 HTML 文本，序列化经 html 节点原样回写——字节不变，不引「打开即未保存」
  content: 'text*',
  group: 'block',
  code: true,
  defining: true,
  toDOM: () => ['pre', { class: 'luci-html-src-static' }, ['code', {}, 0]],
  parseDOM: [{ tag: 'pre.luci-html-src-static', preserveWhitespace: 'full' }],
  parseMarkdown: {
    match: ({ type }) => type === 'htmlTable',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(String(node.value))
      state.closeNode()
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'html_table',
    runner: (state, node) => {
      // 原始 HTML 经 html 节点原样输出（remark-stringify 不转义 html 节点）
      state.addNode('html', undefined, node.textContent)
    }
  }
}))

/** 视图层文档目录（图片相对路径 → luci-img）；WysiwygEditor 挂载/切签时同步 */
let htmlTableDocDir: string | null = null
export function setHtmlTableDocDir(dir: string | null): void {
  htmlTableDocDir = dir
}

/** 选区是否与块节点 [pos, pos+size) 相交（光标进入或整块选中） */
function selectionTouchesBlock(state: EditorState, pos: number, size: number): boolean {
  const sel = state.selection
  return sel.from <= pos + size && sel.to > pos
}

/**
 * HTML 块视图：默认渲染白名单 HTML（只读投影），
 * 光标/选区进入节点时切换成源码块（可编辑），离开后恢复渲染。
 * 渲染层与源码层同时挂在一个 wrapper 下，CSS 按 .is-editing 互斥显示。
 */
class HtmlTableBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private renderEl: HTMLElement
  private view: EditorView
  private getPos: () => number | undefined
  private node: PMNode
  private active = false
  private lastSource = ''

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.className = 'luci-html-block'

    this.renderEl = document.createElement('div')
    this.renderEl.className = 'luci-html-render'
    this.renderEl.contentEditable = 'false'
    this.dom.appendChild(this.renderEl)

    const src = document.createElement('pre')
    src.className = 'luci-html-src'
    const code = document.createElement('code')
    code.className = 'language-html'
    src.appendChild(code)
    this.dom.appendChild(src)

    this.contentDOM = code
    this.render(node)
    this.renderEl.addEventListener('mousedown', this.onRenderMouseDown)
    liveHtmlBlockViews.add(this)
  }

  /** 点击渲染层：普通点击就地进源码；Ctrl/Cmd+点击打开表格内链接 */
  private onRenderMouseDown = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]')
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      openLinkTarget(a.getAttribute('href') ?? '')
      return
    }
    e.preventDefault()
    const pos = this.getPos()
    if (pos == null) return
    // 先亮出源码层，再落光标——否则 display:none 的 contentDOM 收不到选区
    this.setActive(true)
    const state = this.view.state
    const target = Math.min(pos + 1, state.doc.content.size)
    this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(target))))
    this.view.focus()
  }

  private render(node: PMNode): void {
    const raw = node.textContent
    if (raw === this.lastSource) return
    this.lastSource = raw
    // 展示走净化 + 图片协议改写；节点里始终是原始 HTML
    this.renderEl.innerHTML = rewriteHtmlImgSrc(sanitizeHtmlTableBlock(raw), htmlTableDocDir)
  }

  private setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    this.dom.classList.toggle('is-editing', active)
    if (!active) this.render(this.node)
  }

  /** 每次 view 更新都调用（选区变化不会触发 NodeView.update） */
  syncActive(state: EditorState): void {
    const pos = this.getPos()
    if (pos == null) return
    this.setActive(selectionTouchesBlock(state, pos, this.node.nodeSize))
  }

  /** 块在文档中的位置（键盘进出块时按它定位 NodeView） */
  anchorPos(): number | undefined {
    return this.getPos()
  }

  /** 键盘进入块前先亮源码层 */
  reveal(): void {
    this.setActive(true)
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'html_table') return false
    this.node = node
    if (!this.active) this.render(node)
    return true
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    // 渲染层是纯投影；源码层（contentDOM）的突变必须交给 ProseMirror
    return !this.contentDOM.contains(m.target as Node)
  }

  destroy(): void {
    this.renderEl.removeEventListener('mousedown', this.onRenderMouseDown)
    liveHtmlBlockViews.delete(this)
  }
}

const liveHtmlBlockViews = new Set<HtmlTableBlockView>()

/** 键盘从相邻块进入 HTML 块前，先把源码层亮出来（隐藏的 contentDOM 收不到选区） */
function revealHtmlBlockAt(pos: number): void {
  for (const v of liveHtmlBlockViews) {
    if (v.anchorPos() === pos) {
      v.reveal()
      return
    }
  }
}

export const htmlTableView = $view(htmlTableSchema.node, () => (node, view, getPos) =>
  new HtmlTableBlockView(node, view, getPos)
)

/** 选区驱动的 HTML 块渲染/源码切换（NodeView.update 不覆盖纯选区变化） */
export const htmlBlockSyncPlugin = $prose(
  () =>
    new Plugin({
      view: () => ({
        update: (view: EditorView) => {
          for (const v of [...liveHtmlBlockViews]) v.syncActive(view.state)
        }
      })
    })
)

/**
 * 上下方向键进出 HTML 块：内容层收起时浏览器无法把光标落进隐藏的 contentDOM，
 * ProseMirror 会直接跳过整块。这里在块边界接管方向键，先亮源码再落光标。
 */
export function createHtmlBlockKeyPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: (view, event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
        const { state } = view
        const sel = state.selection
        if (!(sel instanceof TextSelection) || !sel.empty) return false
        const $head = sel.$head
        if (!$head.parent.isTextblock) return false

        if ($head.parent.type.name === 'html_table') {
          // 源码态里走到首/末行：退出块（离开后渲染层自动恢复）
          if (event.key === 'ArrowUp' && view.endOfTextblock('up')) {
            const before = $head.before($head.depth)
            view.dispatch(
              state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.max(0, before)), -1))
            )
            return true
          }
          if (event.key === 'ArrowDown' && view.endOfTextblock('down')) {
            const after = $head.after($head.depth)
            view.dispatch(
              state.tr.setSelection(
                TextSelection.near(state.doc.resolve(Math.min(after, state.doc.content.size)), 1)
              )
            )
            return true
          }
          return false
        }

        if (event.key === 'ArrowUp') {
          if (!view.endOfTextblock('up')) return false
          const before = $head.before($head.depth)
          if (before <= 0) return false
          const prev = state.doc.resolve(before).nodeBefore
          if (!prev || prev.type.name !== 'html_table') return false
          const start = before - prev.nodeSize
          revealHtmlBlockAt(start)
          const target = start + Math.max(1, prev.content.size)
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)))
          return true
        }

        if (!view.endOfTextblock('down')) return false
        const after = $head.after($head.depth)
        const next = state.doc.resolve(after).nodeAfter
        if (!next || next.type.name !== 'html_table') return false
        revealHtmlBlockAt(after)
        const target = Math.min(after + 1, state.doc.content.size)
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)))
        return true
      }
    }
  })
}

/* ---------- 链接：Typora 语义（Ctrl/Cmd+点击打开；光标进入就地展开源码） ---------- */

/** 打开链接目标；相对路径按文档目录解析成本机文件 */
function openLinkTarget(href: string): void {
  const url = href.trim()
  if (!url) return
  if (/^(?:https?:\/\/|mailto:)/i.test(url)) {
    window.open(url, '_blank', 'noopener')
    return
  }
  if (url.startsWith('#')) {
    const id = decodeURIComponent(url.slice(1))
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return // 其他协议（luci-img 等）不打开
  if (!htmlTableDocDir) return
  // 相对链接交给渲染层解析（能拿到文档目录；.md 应用内打开，其余走系统默认）
  window.dispatchEvent(new CustomEvent('luci:open-relative-link', { detail: { href: url } }))
}

/**
 * 即显里的链接是 PM link mark（<a href>）：默认点击会让 Electron 整页导航，
 * 必须拦。约定与 Typora 一致——普通点击只落光标（便于就地编辑），
 * Ctrl/Cmd+点击才打开；打开走 window.open → 主进程 setWindowOpenHandler
 * 转系统浏览器/默认应用（与预览模式链接同一条链路）
 */
export function createLinkClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null
        const a = target?.closest?.('a[href]')
        if (!a) return false
        event.preventDefault() // 阻止应用内导航
        if (event.ctrlKey || event.metaKey) openLinkTarget(a.getAttribute('href') ?? '')
        return false // 光标照常落位（PM 默认行为）
      }
    }
  })
}

interface LinkSourceInfo {
  from: number
  to: number
  href: string
  mark: Mark
}

/** 光标所在链接的整段范围（同一 link mark 的连续文本） */
function findLinkSource(state: EditorState): LinkSourceInfo | null {
  const sel = state.selection
  if (!sel.empty) return null
  const linkType = state.schema.marks.link
  if (!linkType) return null
  const $pos = sel.$from
  if (!$pos.parent.isTextblock) return null

  const children: { from: number; to: number; node: PMNode }[] = []
  let pos = $pos.start()
  $pos.parent.forEach((child) => {
    children.push({ from: pos, to: pos + child.nodeSize, node: child })
    pos += child.nodeSize
  })
  const idx = children.findIndex((c) => c.node.isText && $pos.pos >= c.from && $pos.pos <= c.to)
  if (idx < 0) return null
  const markAt = (i: number): Mark | null =>
    children[i]?.node.marks.find((m) => m.type === linkType) ?? null
  // 光标正好停在链接起点（前一个文本节点的末尾）时归到链接这一侧
  let active = idx
  if (!markAt(active) && $pos.pos === children[active].to && active + 1 < children.length && markAt(active + 1)) {
    active++
  }
  const mark = markAt(active)
  if (!mark) return null

  let start = active
  while (start > 0 && markAt(start - 1)?.eq(mark)) start--
  let end = active
  while (end < children.length - 1 && markAt(end + 1)?.eq(mark)) end++
  return {
    from: children[start].from,
    to: children[end].to,
    href: String(mark.attrs.href ?? ''),
    mark
  }
}

/** 展开后的地址行：提交新地址（空 = 去掉链接），只动这一个链接的范围 */
function commitLinkHref(view: EditorView, info: LinkSourceInfo, raw: string): void {
  const href = raw.trim()
  if (href === info.href) return
  const { state } = view
  const linkType = state.schema.marks.link
  if (!linkType || info.to > state.doc.content.size) return
  linkCache = null
  const tr = state.tr.removeMark(info.from, info.to, linkType)
  if (href) {
    tr.addMark(info.from, info.to, linkType.create({ ...info.mark.attrs, href }))
  }
  view.dispatch(tr)
}

function bracketEl(text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'luci-link-src-bracket'
  span.textContent = text
  span.contentEditable = 'false'
  return span
}

function buildLinkTail(view: EditorView, info: LinkSourceInfo): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'luci-link-src-tail'
  wrap.contentEditable = 'false'

  const open = bracketEl('](')
  const input = document.createElement('input')
  input.className = 'luci-link-src-url'
  input.spellcheck = false
  input.value = info.href
  input.size = Math.max(8, Math.min(80, info.href.length))
  input.setAttribute('aria-label', '链接地址')
  const close = bracketEl(')')

  let settled = false
  const commit = (): void => {
    if (settled) return
    settled = true
    commitLinkHref(view, info, input.value)
  }

  input.addEventListener('mousedown', (e) => e.stopPropagation())
  input.addEventListener('click', (e) => e.stopPropagation())
  input.addEventListener('input', () => {
    input.size = Math.max(8, Math.min(80, input.value.length))
  })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      input.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      settled = true
      input.value = info.href
      linkCache = null
      input.blur()
    }
  })
  input.addEventListener('blur', () => commit())

  wrap.append(open, input, close)
  return wrap
}

/** 装饰缓存：输入地址期间避免每次选区刷新都重建 input（会丢焦点） */
let linkCache: { info: LinkSourceInfo; decos: DecorationSet } | null = null

/**
 * 光标进入链接时就地展开 `[文字](地址)`（Typora 行内源码）：
 * 方括号是 widget，地址是行内输入框；离开链接自动收回成普通链接。
 */
export function createLinkSourcePlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const info = findLinkSource(state)
        if (!info) {
          linkCache = null
          return null
        }
        if (
          linkCache &&
          linkCache.info.from === info.from &&
          linkCache.info.to === info.to &&
          linkCache.info.href === info.href
        ) {
          return linkCache.decos
        }
        const decos = DecorationSet.create(state.doc, [
          Decoration.widget(info.from, () => bracketEl('['), { side: -1 }),
          Decoration.inline(info.from, info.to, { class: 'luci-link-src-text' }),
          Decoration.widget(info.to, (view) => buildLinkTail(view, info), { side: 1 })
        ])
        linkCache = { info, decos }
        return decos
      }
    }
  })
}
