<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick, computed } from 'vue'
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
  editorViewCtx,
  serializerCtx,
  remarkCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx
} from '@milkdown/kit/core'
import {
  commonmark,
  imageSchema
} from '@milkdown/kit/preset/commonmark'
import {
  gfm,
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  setAlignCommand,
  selectRowCommand,
  selectColCommand,
  selectTableCommand,
  deleteSelectedCellsCommand
} from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { history } from '@milkdown/kit/plugin/history'
import { replaceAll, $prose, callCommand } from '@milkdown/kit/utils'
import { NodeSelection, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { lift } from '@milkdown/kit/prose/commands'
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
import {
  createFindPlugin,
  onFindStatus,
  findOpen as pmFindOpen,
  findClose as pmFindClose,
  findSetQuery,
  findGo as pmFindGo,
  findReplaceCurrent,
  findReplaceAll
} from '@/editor/pm-find'
import { createCenterPlugin } from '@/editor/pm-center'
import { findState, sameQuery } from '@/editor/find-state'
import { saveViewProgress, loadView } from '@/editor/tab-view-state'
import { applyCachedImageSizes, rememberImgSize } from '@/editor/img-size-cache'
import { createWysiwygImagePlugin } from '@/editor/pm-wysiwyg-image'
import { createElementToolbar, type ElToolbarState } from '@/editor/pm-element-toolbar'
import { createCodeblockChromePlugin } from '@/editor/pm-codeblock-chrome'
import { createCodeHighlightPlugin } from '@/editor/pm-code-highlight'
import { createQuoteEscapePlugin } from '@/editor/pm-quote-escape'
import { createTaskTogglePlugin } from '@/editor/pm-task-toggle'
import { parseAltMods, buildAltMods, stepWidth, luciToDisplaySrc, type ImageMods } from '@/editor/image-utils'
import { splitAdjacentOrderedLists } from '@/services/markdown'
// 单换行 → 硬换行：与预览管线 markdown-it 的 breaks:true 对齐（否则即显把
// 段内单换行折叠成空格，同一文档两种模式显示不一致）
import remarkBreaks from 'remark-breaks'
import { t } from '@/i18n'
// 图片修饰符即显渲染:extendSchema 返回新 holder,须 .use 挂载生效
import { styledImageSchema } from '@/editor/wysiwyg-image-style'
// KaTeX 数学（ROADMAP 1.1）：remark-math 解析 + atom 节点嵌套视图编辑
import remarkMath from 'remark-math'
import {
  mathInlineSchema,
  mathBlockSchema,
  mathInlineView,
  mathBlockView,
  inlineMathInputRule,
  blockMathInputRule,
  guardMathText
} from '@/editor/wysiwyg-math'
// Mermaid 图表（ROADMAP 1.2）：code_block 双模 nodeView（mermaid 渲染/其他语言原样）
import { mermaidCodeView, mermaidFocusPlugin, rethemeMermaidViews } from '@/editor/wysiwyg-mermaid'
import type { FindQuery, FindStatus } from '@/find-shared'
import FindBar from './FindBar.vue'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import '@/assets/wysiwyg.css'

/**
 * 即显（所见即所得）模式：Milkdown/ProseMirror 内核，vanilla API 手动挂载。
 * 与源码模式共用 documents store 作为唯一数据源：
 * - 编辑 → markdownUpdated → updateContent（标脏、走既有保存链路）
 * - 切标签 → replaceAll 整档替换（applying 护栏防误标脏）
 * 组件按需挂载（v-if），进入即显模式时天然读取最新内容。
 */
const docs = useDocumentsStore()
const ui = useUiStore()
const host = ref<HTMLElement | null>(null)

let editor: Editor | null = null
let tabId: number | null = docs.activeId
let applying = false
/** create 完成前收到替换请求时暂存 */
let pending: string | null = null

function applyReplace(markdown: string): void {
  applying = true
  try {
    editor?.action(replaceAll(toWysiwygSource(markdown)))
  } finally {
    applying = false
  }
}

/* ---------- 代码块编辑体验 ---------- */

type MaybeNodeSelection = { node?: { type: { name: string; spec: { code?: boolean } } } }

function inCodeBlock(state: EditorState): boolean {
  const sel = state.selection as typeof state.selection & MaybeNodeSelection
  // 文本光标在代码块内，或整个代码块节点被选中（点击 pre 即节点选区）。
  // 按名判断而非 code 标记：math_block 也带 code:true（嵌套视图换行用），但非代码块语义
  return sel.$from.parent.type.name === 'code_block' || sel.node?.type.name === 'code_block'
}

/** 节点选区时先把文本光标放进代码块首行 */
function focusCodeStart(view: EditorView): boolean {
  const sel = view.state.selection as typeof view.state.selection & MaybeNodeSelection
  if (!sel.node?.type.spec.code) return false
  const $pos = view.state.doc.resolve(sel.from + 1)
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)))
  return true
}

/** 退出代码块：光标移到代码块之后（append = 先追加一个空段落） */
function exitCodeBlock(view: EditorView, append: boolean): void {
  const { state } = view
  const { $from } = state.selection
  const after = $from.after($from.depth)
  if (append) {
    const para = state.schema.nodes.paragraph.create()
    const tr = state.tr.insert(after, para)
    tr.setSelection(TextSelection.near(tr.doc.resolve(after)))
    view.dispatch(tr)
  } else {
    const pos = state.doc.resolve(Math.min(after, state.doc.content.size))
    view.dispatch(state.tr.setSelection(TextSelection.near(pos, 1)))
  }
}

/**
 * 按键拦截：
 * - 代码块内 Tab / Shift+Tab → 插入/删除缩进（否则浏览器会把焦点跳到状态栏）
 * - 列表项 Tab / Shift+Tab → 降一级 / 升一级，顶层再升即退出列表（Typora 语义）
 * - 普通段落 Tab → 插入/删除 2 空格（焦点留在编辑器）
 * - Esc → 退出代码块编辑（光标落到块后）；引用块的跳出在 pm-quote-escape 插件
 * - Ctrl/Cmd+Enter → 在代码块后新建段落继续写作
 * - 代码块内 Ctrl/Cmd+A → 只选块内内容，再按一次才全选整档
 * - 普通段落回车 → 软换行（对齐双栏源码的回车语义）；紧贴换行再回车 = 分段
 */
function inListItem(state: EditorState): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'list_item') return true
  }
  return false
}

function inTable(state: EditorState): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name.startsWith('table')) return true
  }
  return false
}

/** 光标前一个内联节点是否为硬换行（连续回车升级为真实分段的判据） */
function afterHardbreak(state: EditorState): boolean {
  const { $from } = state.selection
  if ($from.parentOffset === 0) return false
  let found: string | null = null
  $from.parent.forEach((child, offset) => {
    if (offset + child.nodeSize === $from.parentOffset) found = child.type.name
  })
  return found === 'hardbreak'
}

function handleKeys(view: EditorView, event: KeyboardEvent): boolean {
  const { state } = view
  if (event.key === 'Tab') {
    // 始终拦截:普通段落放行 Tab 会被浏览器抢走焦点(跳到状态栏按钮)
    event.preventDefault()
    if (!inCodeBlock(state)) {
      const itemType = state.schema.nodes.list_item
      if (inListItem(state) && itemType) {
        // 列表项：Tab 降一级；Shift+Tab 升一级，顶层再升 = 整项提出列表（退出序号）
        if (!event.shiftKey && sinkListItem(itemType)(state, view.dispatch)) return true
        if (event.shiftKey) {
          if (liftListItem(itemType)(state, view.dispatch)) return true
          if (lift(state, view.dispatch)) return true
        }
        return true // 无法升降时也不放行（保持焦点，避免浏览器跳焦点）
      }
      // 普通段落:插入/删除 2 空格,焦点留在编辑器
      const { $from } = state.selection
      if (event.shiftKey) {
        const lineText = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
        const m = /^ {1,2}/.exec(lineText)
        if (m) view.dispatch(state.tr.delete($from.start(), $from.start() + m[0].length))
      } else {
        view.dispatch(state.tr.insertText('  '))
      }
      return true
    }
    if (event.shiftKey) {
      const { $from } = state.selection
      const lineText = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const m = /^ {1,2}/.exec(lineText)
      if (m) view.dispatch(state.tr.delete($from.start(), $from.start() + m[0].length))
    } else {
      focusCodeStart(view)
      view.dispatch(view.state.tr.insertText('  '))
    }
    return true
  }
  if (event.key === 'Escape' && inCodeBlock(state)) {
    exitCodeBlock(view, false)
    return true
  }
  // 代码块内 Ctrl/Cmd+A → 只选块内内容（VS Code 语义）；已全选块时放行给
  // 默认行为（再按一次升级为全选整档）
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'a' &&
    inCodeBlock(state)
  ) {
    const sel = state.selection as typeof state.selection & MaybeNodeSelection
    // 点选整块（节点选区）：转成块内文本全选
    if (sel.node?.type.spec.code) {
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, sel.from + 1, sel.to - 1))
      )
      return true
    }
    const { $from } = state.selection
    const start = $from.start()
    const end = start + $from.parent.content.size
    if (state.selection.from <= start && state.selection.to >= end) return false
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)))
    return true
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && inCodeBlock(state)) {
    exitCodeBlock(view, true)
    return true
  }
  // 空段落输入 `$$` 后回车 → 空数学块（Typora 语义）；替换后即选中进入源码编辑
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    state.schema.nodes.math_block
  ) {
    const { $from } = state.selection
    if ($from.parent.type.name === 'paragraph' && $from.parent.textContent.trim() === '$$') {
      const blockType = state.schema.nodes.math_block
      const from = $from.before()
      const tr = state.tr.replaceWith(from, $from.after(), blockType.create())
      tr.setSelection(NodeSelection.create(tr.doc, from))
      view.dispatch(tr)
      return true
    }
  }
  // 回车 = 软换行（与双栏源码「回车只换一行」一致）；光标紧贴换行后再按回车
  // 升级为真实分段（对应双栏的「空行分段」）。列表/表格/标题/代码块保持默认
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !inCodeBlock(state) &&
    !inListItem(state) &&
    !inTable(state)
  ) {
    const { $from } = state.selection
    if ($from.parent.type.name === 'paragraph' && $from.parent.content.size > 0 && !afterHardbreak(state)) {
      event.preventDefault()
      view.dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hardbreak.create()))
      return true
    }
  }
  return false
}

/* ---------- 本地相对路径图片 ⇄ luci-img://（数据层改写） ---------- */

/**
 * remark mdast 清洗：Milkdown 的 image schema 声明 `validate: "string"`，
 * 而 remark 对无 alt/title 的图片给出 null → PM 校验抛 RangeError →
 * Milkdown 的 addNode 把失败静默吞掉 → 图片节点蒸发（段落一起消失）。
 * 在 remark 解析后、PM 转换前把 null 归一化为空串。
 */
interface MdastNode {
  type?: string
  depth?: number
  alt?: unknown
  title?: unknown
  children?: MdastNode[]
}

function normalizeImageNulls() {
  return (tree: MdastNode): void => {
    const walk = (n: MdastNode): void => {
      if (n.type === 'image') {
        if (n.alt === null || n.alt === undefined) n.alt = ''
        if (n.title === null || n.title === undefined) n.title = ''
      }
      n.children?.forEach((c) => walk(c))
    }
    walk(tree)
  }
}

/** 相邻有序列表分隔的哨兵（toWysiwygSource 注入的空一级标题）：
 *  remark 解析后移除，PM 文档与序列化输出里不留痕迹 */
function dropSplitHeadings() {
  return (tree: MdastNode): void => {
    if (!tree.children) return
    tree.children = tree.children.filter(
      (c) => !(c.type === 'heading' && c.depth === 1 && (!c.children || c.children.length === 0))
    )
  }
}

/**
 * Milkdown/ProseMirror 按 src 字面值渲染 <img>，相对路径相对应用源解析必裂图；
 * 在 DOM 层改写会被 ProseMirror 的 DOM 同步恢复（上一版方案无效的根因）。
 * 改在数据层：进入即显时把相对路径转为 luci-img:// 绝对协议（state 里显示正确），
 * markdownUpdated 序列化时转回相对路径（store/磁盘上永远是原始相对路径）。
 * 代码围栏内的伪图片文本不动（逐行 + 围栏状态扫描）。
 */
function buildLuciUrl(absPath: string): string {
  return (
    'luci-img://' +
    encodeURIComponent(absPath).replace(/%2F/gi, '/').replace(/\(/g, '%28').replace(/\)/g, '%29')
  )
}

function docDirOf(): string | null {
  const p = docs.active?.path
  if (!p) return null
  const sepIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return sepIdx > 0 ? p.slice(0, sepIdx).replace(/\\/g, '/') : null
}

/** 相对路径图片 → luci-img://（跳过协议/绝对/锚点与代码围栏）；
 *  同时做相邻有序列表分隔（与 markdown-it 预览管线同一预处理，两模式渲染一致）：
 *  注入的空标题哨兵由 remark transformer dropSplitHeadings 在解析后移除 */
function toWysiwygSource(md: string): string {
  const docDir = docDirOf()
  let src = splitAdjacentOrderedLists(md)
  if (!docDir) return src
  const lines = src.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const fm = /^(\s*)(`{3,}|~{3,})/.exec(lines[i])
    if (fm) {
      if (fence === null) fence = fm[2].slice(0, 1).repeat(3)
      else if (lines[i].trimStart().startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    lines[i] = lines[i].replace(
      /(\]\()([^)\s]+)(\))/g,
      (whole, open: string, src: string, close: string) => {
        if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|#)/.test(src)) return whole
        let rel = src.replace(/^\.\//, '')
        try {
          rel = decodeURIComponent(rel)
        } catch {
          /* 游离 % 序列按原样 */
        }
        return `${open}${buildLuciUrl(`${docDir}/${rel}`)}${close}`
      }
    )
  }
  return lines.join('\n')
}

/** luci-img:// → 原始相对路径（文档目录内的）；目录外的保留绝对路径。
 *  顺带归一化：milkdown 把空段落序列化为 `<br />` 行，转回空行——
 *  否则双栏源码里出现字面 `<br />`，预览因 html:false 转义后原样可见；
 *  milkdown 对重建后的有序列表会把分隔符写成 `)`，统一归一化回 `.`；
 *  remark-stringify 还会把正文 `$` 保守转义成 `\$`——误判护栏已保证裸 `$`
 *  不会再被配成公式，这里围栏/行内码感知地还原字面 `$`，不让文件积累反斜杠 */
function fromWysiwygSource(md: string): string {
  const docDir = docDirOf()
  const lines = md
    .split('\n')
    .map((l) =>
      /^[ \t]*<br\s*\/?>[ \t]*$/i.test(l)
        ? ''
        : l.replace(/^([ \t]*\d+[.)][ \t]*)<br\s*\/?>[ \t]*$/i, '$1') // 列表项内空段落：`2. <br />` → `2. `
        )
    .join('\n')
    .replace(/^(\s*\d+)\)/gm, '$1.')
    .replace(/^([ \t]*)\*([ \t])/gm, '$1-$2')
    .split('\n')
  // \$ → $（跳过代码围栏、数学块与行内码段）
  let fence: string | null = null
  let inMath = false
  for (let i = 0; i < lines.length; i++) {
    const fm = /^(\s*)(`{3,}|~{3,})/.exec(lines[i])
    if (fm) {
      if (fence === null) fence = fm[2].slice(0, 1).repeat(3)
      else if (lines[i].trimStart().startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    const t = lines[i].trim()
    if (!inMath && t.startsWith('$$')) {
      inMath = true
      continue
    }
    if (inMath) {
      if (t.includes('$$')) inMath = false
      continue
    }
    lines[i] = lines[i]
      .split(/(`[^`]*`)/)
      .map((seg) => (seg.startsWith('`') ? seg : seg.replace(/\\\$/g, '$')))
      .join('')
  }
  let out = lines.join('\n')
  if (!docDir) return out
  return out.replace(/\]\(luci-img:\/\/([^)\s]+)\)/g, (_whole, enc: string) => {
    let abs: string
    try {
      abs = decodeURIComponent(enc)
    } catch {
      return `](luci-img://${enc})`
    }
    const normDir = docDir.toLowerCase()
    const normAbs = abs.replace(/\\/g, '/')
    if (normAbs.toLowerCase().startsWith(normDir + '/')) {
      return `](./${normAbs.slice(normDir.length + 1)})`
    }
    return `](${normAbs})`
  })
}

/* ---------- 查找替换（Ctrl+F，ProseMirror 层实现见 editor/pm-find.ts） ---------- */

/** 查询状态是唯一真源：FindBar 编辑 → findQuery → watch 驱动插件 */
const findBarOpen = ref(false)
const findQuery = ref<FindQuery>({ text: '', caseSensitive: false, regexp: false, wholeWord: false })
const replaceText = ref('')
const findCount = ref(0)
const findActive = ref(-1)
const findError = ref(false)
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)

/** 查找状态按「标签」共享（同一文档四模式一份）：refs 当前属于哪个标签 */
const findTabId = ref<number | null>(null)
/** 拉回共享槽位期间抑制 findQuery watcher 的自动应用（拉回自己做显式处理，不跳转） */
let findSyncing = false

/** refs → 标签槽（值相同直接跳过；双栏另一侧同步读取） */
function pushFind(): void {
  const st = findState(findTabId.value)
  if (
    st.open === findBarOpen.value &&
    sameQuery(st.query, findQuery.value) &&
    st.replace === replaceText.value &&
    st.active === findActive.value
  ) {
    return
  }
  st.open = findBarOpen.value
  st.query = { ...findQuery.value }
  st.replace = replaceText.value
  st.active = findActive.value
}

/** 标签槽 → refs：切标签/挂载/双栏另一侧改了共享状态；开着时重新亮起但不动滚动 */
function pullFind(id: number | null, force = false): void {
  const st = findState(id)
  if (
    !force &&
    st.open === findBarOpen.value &&
    sameQuery(st.query, findQuery.value) &&
    st.replace === replaceText.value &&
    st.active === findActive.value
  ) {
    findTabId.value = id
    return
  }
  findTabId.value = id
  findSyncing = true
  findQuery.value = { ...st.query }
  replaceText.value = st.replace
  const view = getView()
  if (view) {
    if (st.open) pmFindOpen(view, { ...st.query }, { scroll: false, active: st.active })
    else if (findBarOpen.value) pmFindClose(view)
  } else {
    findBarOpen.value = st.open // 编辑器未就绪：仅同步条开关，插件状态就绪后再补
  }
  void nextTick(() => {
    findSyncing = false
  })
}

/** 插件状态 → Vue 回显（插件经 onFindStatus 推送） */
function syncFindStatus(s: FindStatus): void {
  findBarOpen.value = s.open
  findCount.value = s.count
  findActive.value = s.active
  findError.value = s.error
}

function getView(): EditorView | null {
  try {
    return editor?.action((ctx) => ctx.get(editorViewCtx)) ?? null
  } catch {
    return null
  }
}

/** 打开查找条：有非空单行选区时预填为搜索词（Typora 习惯） */
function openFind(): void {
  const view = getView()
  if (!view) return
  const { from, to, empty } = view.state.selection
  if (!empty && to - from <= 200) {
    const text = view.state.doc.textBetween(from, to, '\n', '')
    if (text && !text.includes('\n')) findQuery.value = { ...findQuery.value, text }
  }
  pmFindOpen(view, { ...findQuery.value })
  void nextTick(() => findBarRef.value?.focusInput())
}

function closeFind(): void {
  const view = getView()
  if (!view) return
  pmFindClose(view)
  view.focus()
}

function goFind(dir: 1 | -1): void {
  const view = getView()
  if (view) pmFindGo(view, dir)
}

function doReplace(): void {
  const view = getView()
  if (view) findReplaceCurrent(view, replaceText.value)
}

function doReplaceAll(): void {
  const view = getView()
  if (view) findReplaceAll(view, replaceText.value)
}

watch(findQuery, (q) => {
  if (findSyncing) return // 拉回共享状态不是一次新查询，不导航不跳转
  const view = getView()
  if (view && findBarOpen.value) findSetQuery(view, { ...q })
})

/* refs → 共享槽位：查找条任何状态变化即推送（双栏另一侧/其他模式同步读取） */
watch([findBarOpen, findQuery, replaceText, findActive], () => {
  if (findSyncing) return
  pushFind()
})

/* 共享槽位 → refs：切进本模式/双栏另一侧改了同一标签的查找状态 */
watch(
  () => {
    const st = findState(findTabId.value)
    return [st.open, st.query.text, st.query.caseSensitive, st.query.regexp, st.query.wholeWord, st.replace, st.active] as const
  },
  () => {
    if (findSyncing) return
    pullFind(findTabId.value)
  }
)

/* 菜单 Ctrl+F → 打开即显查找条（不再切回双栏） */
watch(
  () => ui.findRequest,
  () => {
    if (ui.editorMode === 'wysiwyg') openFind()
  }
)

/* 兜底：浏览器 mock 下没有 Electron 菜单，Ctrl+F 直接接管；
   Electron 下加速键由应用菜单统一接管（可改键），旧的硬编码键不再生效 */
function onWinKeydown(e: KeyboardEvent): void {
  if (navigator.userAgent.includes('Electron')) return
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    openFind()
  }
}

/* ---------- 生命周期 ---------- */

/* 查找插件：每次挂载都要一个全新 PM 插件实例（工厂在 Editor 创建时调用） */
const findProse = $prose(() => createFindPlugin())
// GitHub 居中块显示层（<div align="center">,详见 pm-center.ts）
const centerProsePlugin = $prose(() => createCenterPlugin())
// 图片粘贴/拖拽:占位图 → 上传 → 原地换链接（与源码模式共用上传链路）
const wysiwygImagePlugin = $prose(() => createWysiwygImagePlugin())
// 图片/表格点击 → 元素工具条(浮层数据源)
const elToolbar = ref<ElToolbarState | null>(null)
const elToolbarPlugin = $prose(() =>
  createElementToolbar((state) => {
    elToolbar.value = state
  })
)
  // 代码块 chrome：语言标签栏 + 复制按钮（每块上方 widget 栏）
  const codeblockChromePlugin = $prose(() => createCodeblockChromePlugin())
  // 代码块语法高亮（hljs，与预览同一语言注册表与配色令牌）
  const codeHighlightPlugin = $prose(() => createCodeHighlightPlugin())
// Esc 跳出引用块（列表 Tab/Shift+Tab 在视图级 handleKeys，优先级更高）
const quoteEscapePlugin = $prose(() => createQuoteEscapePlugin())
// 任务列表点击切换复选框（milkdown 无内置交互）
const taskTogglePlugin = $prose(() => createTaskTogglePlugin())

/* ---------- 元素工具条:图片/表格操作 ---------- */

function withView(fn: (view: EditorView) => void): void {
  if (!editor) return
  editor.action((ctx) => fn(ctx.get(editorViewCtx)))
}

/** 选中图片的展示地址（工具条地址行;luci-img:// 已解回用户写的路径） */
const elImgSrcFull = computed(() => {
  const t = elToolbar.value
  if (!t || t.kind !== 'image') return ''
  let raw = ''
  withView((view) => {
    raw = String(view.state.doc.nodeAt(t.pos)?.attrs.src ?? '')
  })
  return luciToDisplaySrc(raw, docDirOf())
})

async function copyImgSrc(): Promise<void> {
  const text = elImgSrcFull.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板 API 被拒（失焦等）→ execCommand 兜底
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  ui.showToast(t('img.srcCopied'))
}

/* ---------- 图片悬浮地址提示：贴图片下缘内侧,不遮挡正文 ---------- */

const imgTip = ref<{ x: number; y: number; w: number; text: string } | null>(null)

function onHostOver(e: MouseEvent): void {
  const target = e.target
  if (!(target instanceof HTMLImageElement) || !target.closest('.luci-prose')) return
  if (elToolbar.value) return // 图片已选中时工具条上有完整地址,不重复提示
  const text = luciToDisplaySrc(target.getAttribute('src') ?? '', docDirOf())
  if (!text) return // 上传占位图（data:）不提示
  const h = host.value
  if (!h) return
  const ir = target.getBoundingClientRect()
  const hr = h.getBoundingClientRect()
  imgTip.value = {
    x: ir.left - hr.left + h.scrollLeft,
    y: ir.top - hr.top + h.scrollTop + ir.height,
    w: ir.width,
    text
  }
}

function onHostOut(e: MouseEvent): void {
  if (!imgTip.value) return
  if (e.target === e.relatedTarget) return
  imgTip.value = null
}

const imgTipStyle = computed(() => {
  const t = imgTip.value
  if (!t) return {}
  return { left: `${t.x + 8}px`, top: `${t.y - 8}px`, maxWidth: `${Math.max(60, t.w - 16)}px` }
})

/* 图片被选中（工具条出现）时收起悬浮地址:工具条上有完整地址,提示就多余了 */
watch(elToolbar, (t) => {
  if (t) imgTip.value = null
})

/* ---------- 切签/切模式滚动恢复（共享浏览进度） ----------
 * 进度 = 垂直滚动比例（scrollTop / 可滚动高度），同一文档所有模式共享一份：
 * 模式互切保持同一位置，切签恢复该文档的进度。图片加载改变高度的窗口期，
 * onHostImgLoad 反复按进度重新落位钉住；用户滚轮即接管停用 */
let pendingFrac: number | null = null
let wysiwygAlignScheduled = false
let wysiwygAlignTimer: number | undefined

/** 按共享进度落位 */
function applyWysiwygProgress(): void {
  const hostEl = host.value
  if (!hostEl || pendingFrac === null) return
  hostEl.scrollTop = pendingFrac * Math.max(0, hostEl.scrollHeight - hostEl.clientHeight)
}

/** 图片加载：记录固有尺寸（供重进首帧占位）+ 批量按进度重新落位；
 *  最后一次加载 200ms 后再补一次（布局完全收敛后的终落位） */
function onHostImgLoad(e: Event): void {
  const img = e.target as HTMLImageElement | null
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    rememberImgSize(img.src, img.naturalWidth, img.naturalHeight)
  }
  if (wysiwygAlignScheduled) return
  wysiwygAlignScheduled = true
  requestAnimationFrame(() => {
    wysiwygAlignScheduled = false
    if (!host.value) return
    applyCachedImageSizes(host.value)
    applyWysiwygProgress()
    window.clearTimeout(wysiwygAlignTimer)
    wysiwygAlignTimer = window.setTimeout(applyWysiwygProgress, 200)
  })
}

/** 保存当前浏览进度（切签与切模式离开时共用） */
function saveWysiwygProgress(id: number | null): void {
  if (id === null || !host.value || host.value.offsetParent === null) return
  const hostEl = host.value
  saveViewProgress(id, hostEl.scrollTop / Math.max(1, hostEl.scrollHeight - hostEl.clientHeight))
}

/** 恢复浏览进度（切签与重挂载共用）。多阶段补拍（nextTick/60ms/250ms）
 *  覆盖面板可见性与 PM 渲染的时序竞态；图片加载期间另有逐张重钉 */
function restoreWysiwygScroll(): void {
  pendingFrac = loadView(tabId)?.frac ?? null
  const apply = (): void => {
    if (!host.value) return
    applyCachedImageSizes(host.value)
    applyWysiwygProgress()
  }
  void nextTick(apply)
  window.setTimeout(apply, 60)
  window.setTimeout(apply, 250)
}

/** 图片:改 alt 修饰符(setNodeMarkup 单事务,可撤销) */
function elImageMods(next: ImageMods | ((cur: ImageMods) => ImageMods)): void {
  const t = elToolbar.value
  if (!t || t.kind !== 'image') return
  withView((view) => {
    const node = view.state.doc.nodeAt(t.pos)
    if (!node || node.type.name !== 'image') return
    const { mods, clean } = parseAltMods(String(node.attrs.alt ?? ''))
    const alt = buildAltMods(clean, typeof next === 'function' ? next(mods) : next)
    if (alt === String(node.attrs.alt)) return
    const tr = view.state.tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, alt })
    // 操作后保持图片选中:setNodeMarkup 会把 NodeSelection 归一为 TextSelection,
    // 工具条会因失配而闪没,这里显式恢复
    tr.setSelection(NodeSelection.create(tr.doc, t.pos))
    view.dispatch(tr)
  })
}

function elImageDelete(): void {
  const t = elToolbar.value
  if (!t || t.kind !== 'image') return
  withView((view) => {
    const node = view.state.doc.nodeAt(t.pos)
    if (!node) return
    view.dispatch(view.state.tr.delete(t.pos, t.pos + node.nodeSize))
  })
}

/* 表格:走 Milkdown gfm 命令(先选中行列/全表,再删) */
function elTable(action: Parameters<Editor['action']>[0]): void {
  if (editor) editor.action(action)
}
function elTableAddRow(before: boolean): void {
  elTable(callCommand((before ? addRowBeforeCommand : addRowAfterCommand).key))
}
function elTableAddCol(left: boolean): void {
  elTable(callCommand((left ? addColBeforeCommand : addColAfterCommand).key))
}
function elTableDeleteRow(): void {
  const t = elToolbar.value
  if (!t) return
  elTable(callCommand(selectRowCommand.key, { index: t.row, pos: t.pos }))
  elTable(callCommand(deleteSelectedCellsCommand.key))
}
function elTableDeleteCol(): void {
  const t = elToolbar.value
  if (!t) return
  elTable(callCommand(selectColCommand.key, { index: t.col, pos: t.pos }))
  elTable(callCommand(deleteSelectedCellsCommand.key))
}
function elTableDeleteTable(): void {
  const t = elToolbar.value
  if (!t) return
  elTable(callCommand(selectTableCommand.key))
  elTable(callCommand(deleteSelectedCellsCommand.key))
}
function elTableAlign(how: 'left' | 'center' | 'right' | 'none'): void {
  elTable(callCommand(setAlignCommand.key, how === 'none' ? undefined : how))
}

/** 浮层定位(贴元素上方,顶到可视区时钳在可见范围内) */
const elToolbarStyle = computed(() => {
  const t = elToolbar.value
  if (!t) return {}
  const top = Math.max(t.rect.y - 40, t.minY)
  return { left: `${t.rect.x + t.rect.w / 2}px`, top: `${top}px` }
})

onMounted(() => {
  if (!host.value) return
  // 点击即显区域任意位置都要让编辑器拿到焦点，避免"点了但打不了字"
  host.value.addEventListener('mousedown', onHostMousedown)
  // 图片悬浮地址提示（mouseover/out 冒泡委托）;滚动即收起避免提示漂移
  host.value.addEventListener('mouseover', onHostOver)
  host.value.addEventListener('mouseout', onHostOut)
  host.value.addEventListener('scroll', onHostScroll, { passive: true })
  // 图片加载：记录尺寸 + 切签锚点重对齐（load 不冒泡，捕获委托）
  host.value.addEventListener('load', onHostImgLoad, { capture: true, passive: true })
  // 用户滚轮即接管：停用切签锚点的自动重对齐
  host.value.addEventListener(
    'wheel',
    () => {
      pendingFrac = null
    },
    { passive: true, capture: true }
  )
  window.addEventListener('keydown', onWinKeydown)
  onFindStatus(syncFindStatus)
  // 重挂载（从其它模式切回）恢复：锚先置 pending（初始图片加载期间即可钉住），
  // create 完成后精确对齐
  restoreWysiwygScroll()
  const instance = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host.value!)
      ctx.set(defaultValueCtx, toWysiwygSource(docs.active?.content ?? ''))
      // remarkPluginsCtx 元素格式为 { plugin, options }（core 按 plug.plugin 取值 use）
      ctx.update(remarkPluginsCtx, (ps) => [
        ...ps,
        { plugin: normalizeImageNulls, options: {} } as never,
        { plugin: dropSplitHeadings, options: {} } as never,
        { plugin: remarkBreaks, options: {} } as never,
        // $...$ / $$...$$ → mdast inlineMath/math，由 wysiwyg-math 的 schema 接住
        { plugin: remarkMath, options: {} } as never,
        // 误判护栏：货币/含空格的 $ 对还原为字面文本（与预览管线对齐，roundtrip 无损）
        { plugin: guardMathText, options: {} } as never
      ])
      // 段内换行序列化为纯换行（remark-stringify 默认输出 `\`+换行 的显式硬换行，
      // 会把反斜杠污染进用户文件；本应用两条管线都把裸换行当硬换行，等价且无损）
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        handlers: { ...prev.handlers, break: () => '\n' }
      }))
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (applying || tabId === null) return
        docs.updateContent(tabId, fromWysiwygSource(markdown))
      })
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: { class: 'luci-prose', spellcheck: 'false' },
        handleKeyDown: (view, event) => handleKeys(view, event)
      }))
    })
    .use(commonmark)
    .use(styledImageSchema)
    .use(gfm)
    // KaTeX 数学：schema → 视图 → 输入规则（顺序无强约束，均需 .use 挂载）
    .use(mathInlineSchema)
    .use(mathBlockSchema)
    .use(mathInlineView)
    .use(mathBlockView)
    .use(inlineMathInputRule)
    .use(blockMathInputRule)
    // Mermaid：code_block nodeView + 焦点追踪（收起源码态）
    .use(mermaidCodeView)
    .use(mermaidFocusPlugin)
    .use(listener)
    // 撤销/重做（1.7 P0）：commonmark 预设不含 history，不挂载即显模式 Ctrl+Z 完全失效
    .use(history)
    .use(findProse)
    .use(centerProsePlugin)
    .use(wysiwygImagePlugin)
    .use(elToolbarPlugin)
    .use(codeblockChromePlugin)
    .use(codeHighlightPlugin)
    .use(quoteEscapePlugin)
    .use(taskTogglePlugin)
  void instance.create().then((e) => {
    editor = e
    // 开发期调试钩子：CDP 查 PM 文档 JSON / 序列化输出 / 内部 remark mdast
    // （定位解析/序列化丢失层）
    if (!import.meta.env.PROD) {
      ;(window as unknown as Record<string, unknown>).__milkDebug = {
        doc: () =>
          editor?.action((ctx) => ctx.get(editorViewCtx).state.doc.toJSON()),
        md: () =>
          editor?.action((ctx) => {
            const ser = ctx.get(serializerCtx)
            const view = ctx.get(editorViewCtx)
            return String(ser(view.state.doc))
          }),
        remark: (src: string) =>
          editor?.action((ctx) => {
            const proc = ctx.get(remarkCtx)
            const tree = proc.runSync(proc.parse(src)) as unknown as MdastNode
            const walk = (n: MdastNode): unknown =>
              n.type === 'image'
                ? { type: n.type, alt: n.alt, title: n.title }
                : { type: n.type, kids: (n.children ?? []).map(walk) }
            return JSON.stringify(walk(tree))
          }),
        contentInfo: () =>
          editor?.action((ctx) => {
            const v = ctx.get(editorViewCtx)
            const hostEl = host.value
            if (!hostEl) return null
            const hostRect = hostEl.getBoundingClientRect()
            const scan: { tag: string; top: number; pos: number }[] = []
            let anchor: number | undefined
            for (const child of v.dom.children) {
              const r = child.getBoundingClientRect()
              scan.push({ tag: child.tagName, top: Math.round(r.top), pos: v.posAtDOM(child, 0) })
              if (anchor === undefined && r.bottom > hostRect.top + 4) anchor = v.posAtDOM(child, 0)
            }
            return {
              anchor,
              scrollTop: Math.round(hostEl.scrollTop),
              scrollHeight: Math.round(hostEl.scrollHeight),
              domTop: Math.round(v.dom.getBoundingClientRect().top),
              first3: scan.slice(0, 3),
              around: scan.filter((s) => s.top > -100 && s.top < 200)
            }
          })
      }
    }
    if (pending !== null) {
      const md = pending
      pending = null
      applyReplace(md)
    }
    // 重挂载恢复的精确落位：PM DOM 就绪后按锚对齐（图片加载期间仍由
    // onHostImgLoad 持续钉住）
    void nextTick(() => {
      const hostEl = host.value
      if (!hostEl) return
      applyCachedImageSizes(hostEl)
      applyWysiwygProgress()
    })
    pullFind(tabId, true) // 编辑器就绪后恢复当前标签共享的查找条状态
  })
})

onBeforeUnmount(() => {
  // 滚动锚落袋必须在这里：模式切换/跨模式切签都会 v-if 卸载本组件，
  // 卸载会跳过排队的 pre-watcher（切签的保存已由 activeId watch 完成，
  // 这里 tabId 与视图内容恒一致，重复保存无害）
  saveWysiwygProgress(tabId)
  ;(window as unknown as Record<string, unknown>).__vpUnmount = {
    tabId,
    scrollTop: host.value?.scrollTop,
    scrollHeight: host.value?.scrollHeight
  }
  pushFind() // 兜底推送（正常情况下每次变化都已实时推送）
  host.value?.removeEventListener('mousedown', onHostMousedown)
  host.value?.removeEventListener('mouseover', onHostOver)
  host.value?.removeEventListener('mouseout', onHostOut)
  host.value?.removeEventListener('scroll', onHostScroll)
  host.value?.removeEventListener('load', onHostImgLoad, { capture: true })
  host.value?.removeEventListener(
    'wheel',
    () => {
      pendingFrac = null
    },
    { capture: true }
  )
  window.removeEventListener('keydown', onWinKeydown)
  window.clearTimeout(wysiwygAlignTimer)
  onFindStatus(null)
  try {
    editor?.destroy()
  } catch {
    /* destroy 期间文档已切换时可能抛错，忽略 */
  }
  editor = null
})

function onHostMousedown(): void {
  try {
    const view = editor?.action((ctx) => ctx.get(editorViewCtx))
    if (view && !view.hasFocus) view.focus()
  } catch {
    /* 编辑器未就绪时忽略 */
  }
}

function onHostScroll(): void {
  imgTip.value = null
  saveWysiwygProgress(tabId) // 浏览进度随滚动持续写入（切模式/切签用它恢复）
}

/* 切换标签：整档替换（编辑器未就绪时暂存，create 完成后应用），
   并恢复该标签的滚动位置（新标签无记录 → 默认顶部）。
   恢复用内容锚（视口顶的文档位置）而非 scroll 比例：图片加载会持续
   改变 scrollHeight，比例落位后随加载漂移；锚点在图片加载期间被
   onHostImgLoad 反复钉住，落位稳定。旧版比例字段保留作兜底 */
watch(
  () => docs.activeId,
  (id, old) => {
    saveWysiwygProgress(old)
    tabId = id
    const markdown = docs.active?.content ?? ''
    if (editor) applyReplace(markdown)
    else pending = markdown
    restoreWysiwygScroll()
    pullFind(id, true)
  }
)

/* 切走即显模式（组件将随 v-if 卸载）：滚动锚的落袋放在 onBeforeUnmount——
   Vue 调度中父组件（EditorArea）的重渲染先于子组件的 pre-watcher 执行，
   v-if 卸载会把子组件排队的 watcher 一并移除，watcher 里保存不可靠 */

/* 外部修改重载：store 内容已被写回，即显面板整档替换 */
watch(
  () => ui.extReloadSeq,
  () => {
    const markdown = docs.active?.content ?? ''
    if (editor) applyReplace(markdown)
    else pending = markdown
  }
)

/* 主题切换 → 重配置 mermaid 并重画图表（图表色是渲染时内联的，CSS 变量跟不了） */
watch(
  () => ui.effectiveTheme,
  (t) => rethemeMermaidViews(t === 'dark')
)
</script>

<template>
  <div class="wysiwyg-wrap">
    <!-- 查找条：停靠在面板顶部，不遮挡正文（Esc 关闭后完全移除） -->
    <FindBar
      v-if="findBarOpen"
      ref="findBarRef"
      :query="findQuery"
      :replace="replaceText"
      :count="findCount"
      :active="findActive"
      :error="findError"
      @update:query="findQuery = $event"
      @update:replace="replaceText = $event"
      @nav="goFind"
      @replace="doReplace"
      @replace-all="doReplaceAll"
      @close="closeFind"
    />
    <div ref="host" class="wysiwyg-host">
      <!-- 图片悬浮地址:贴图片下缘内侧的轻提示,pointer-events 不挡交互 -->
      <div v-if="imgTip" class="img-src-tip" :style="imgTipStyle">{{ imgTip.text }}</div>
      <!-- 元素工具条:点击图片/表格时的浮动操作条(与源码模式工具条同按钮集) -->
      <div v-if="elToolbar" class="el-toolbar" :class="{ col: elToolbar.kind === 'image' }" :style="elToolbarStyle" @mousedown.prevent>
        <template v-if="elToolbar.kind === 'image'">
          <div class="et-src">
            <span class="et-src-text" :title="elImgSrcFull">{{ elImgSrcFull }}</span>
            <button class="et-src-copy" :title="$t('img.copySrc')" @click="copyImgSrc">
              <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5"/><path d="M9.5 4.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>
            </button>
          </div>
          <div class="et-row">
            <button :title="$t('img.wider')" @click="elImageMods((c) => stepWidth(c, 1))">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="3" width="11" height="8" rx="1.5"/><path d="M7 5.5v3M5.75 6.75 7 5.5l1.25 1.25"/></svg>
          </button>
          <button :title="$t('img.narrower')" @click="elImageMods((c) => stepWidth(c, -1))">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="3" width="11" height="8" rx="1.5"/><path d="M7 5.5v3M5.75 7.25 7 8.5l1.25-1.25"/></svg>
          </button>
          <i class="et-sep" />
          <button :title="$t('img.alignLeft')" @click="elImageMods((c) => ({ ...c, align: 'left' }))">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="1.5" y="3.5" width="7" height="7" rx="1"/><path d="M1.5 1.5h11M1.5 12.5h11"/></svg>
          </button>
          <button :title="$t('img.alignCenter')" @click="elImageMods((c) => ({ ...c, align: 'center' }))">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><path d="M1.5 1.5h11M1.5 12.5h11"/></svg>
          </button>
          <button :title="$t('img.alignRight')" @click="elImageMods((c) => ({ ...c, align: 'right' }))">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="5.5" y="3.5" width="7" height="7" rx="1"/><path d="M1.5 1.5h11M1.5 12.5h11"/></svg>
          </button>
          <i class="et-sep" />
          <button :title="$t('img.resetMods')" @click="elImageMods({})">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7a5 5 0 1 1 1.5 3.5M2 7V4m0 3h3"/></svg>
          </button>
          <i class="et-sep" />
          <button class="danger" :title="$t('img.delete')" @click="elImageDelete()">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h8M5.5 4V2.5h3V4M4 4l.5 7.5h5L10 4M6 6.5v3M8 6.5v3"/></svg>
          </button>
          </div>
        </template>
        <template v-else>
          <button :title="$t('table.addRowAbove')" @click="elTableAddRow(true)">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 8.5h10M2 11.5h10M7 1.5v3M5.5 3h3" /></svg>
          </button>
          <button :title="$t('table.addRowBelow')" @click="elTableAddRow(false)">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 2.5h10M2 5.5h10M7 9.5v3M5.5 11h3" /></svg>
          </button>
          <button :title="$t('table.deleteRow')" :disabled="!elToolbar.canDeleteRow" class="danger" @click="elTableDeleteRow()">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 2.5h10M2 5.5h10M2 11h6M9.5 9.5l3.5 3.5M13 9.5l-3.5 3.5" /></svg>
          </button>
          <i class="et-sep" />
          <button :title="$t('table.addColLeft')" @click="elTableAddCol(true)">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6.5 2v10M10 2v10M1.5 7h3M3 5.5v3" /></svg>
          </button>
          <button :title="$t('table.addColRight')" @click="elTableAddCol(false)">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 2v10M7.5 2v10M9.5 7h3M11 5.5v3" /></svg>
          </button>
          <button :title="$t('table.deleteCol')" :disabled="!elToolbar.canDeleteCol" class="danger" @click="elTableDeleteCol()">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 2v10M7.5 2v10M9.5 5.5l4 4M13.5 5.5l-4 4" /></svg>
          </button>
          <i class="et-sep" />
          <button :title="$t('table.alignLeft')" @click="elTableAlign('left')">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M2 7h6M2 10.5h10" /></svg>
          </button>
          <button :title="$t('table.alignCenter')" @click="elTableAlign('center')">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M4 7h6M2 10.5h10" /></svg>
          </button>
          <button :title="$t('table.alignRight')" @click="elTableAlign('right')">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M6 7h6M2 10.5h10" /></svg>
          </button>
          <button :title="$t('table.alignNone')" @click="elTableAlign('none')">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M2 7h10M2 10.5h10" /></svg>
          </button>
          <i class="et-sep" />
          <button :title="$t('table.deleteTable')" class="danger" @click="elTableDeleteTable()">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h8M5.5 4V2.5h3V4M4 4l.5 7.5h5L10 4M6 6.5v3M8 6.5v3" /></svg>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wysiwyg-wrap {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.wysiwyg-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  position: relative;
}

/* 元素工具条:贴目标浮动操作条(图片/表格) */
.el-toolbar {
  position: absolute;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 12, 9, 0.28);
}

/* 图片工具条带地址行 → 纵向两行(地址行 + 按钮行);表格仍是单行按钮 */
.el-toolbar.col {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 6px;
}

.et-src {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 2px 4px;
  border-bottom: 1px solid var(--border);
}

.et-src-text {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, Consolas, 'Cascadia Mono', monospace;
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl; /* 长路径截头保留尾段(文件名是关键信息) */
  text-align: left;
}

.et-src-copy {
  width: 22px !important;
  height: 22px !important;
  flex-shrink: 0;
}

.et-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.el-toolbar button {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.el-toolbar button:hover {
  background: var(--surface-2);
  color: var(--text);
}

.el-toolbar button.danger:hover {
  background: var(--danger);
  color: #fff;
}

.el-toolbar button:disabled {
  opacity: 0.35;
  cursor: default;
}

.el-toolbar button:disabled:hover {
  background: transparent;
  color: var(--text-2);
}

.et-sep {
  width: 1px;
  height: 15px;
  background: var(--border);
  margin: 0 4px;
  flex-shrink: 0;
}

/* 图片悬浮地址:半透明深色 pill 贴图片下缘内侧（压图不压正文,双主题都可读） */
.img-src-tip {
  position: absolute;
  z-index: 5;
  transform: translateY(-100%);
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(22, 18, 14, 0.82);
  color: #f3ede4;
  border: 1px solid rgba(255, 255, 255, 0.14);
  font-family: ui-monospace, Consolas, 'Cascadia Mono', monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  box-shadow: 0 3px 10px rgba(15, 12, 9, 0.25);
}
</style>
