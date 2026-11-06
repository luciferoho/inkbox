import { reactive } from 'vue'
import type { EditorView as PMView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { pmViews } from './pm-registry'
import { curHeadingLevel, pmSetHeading } from './pm-heading'
import { pmInsertLink as pmToggleLink } from './insert-commands'
import { useUiStore } from '@/stores/ui'

/**
 * 选区浮动格式条（5.5，渲染层自绘，FormatBar.vue 渲染）：
 * 即显（ProseMirror）选中文本时浮现——粗体/斜体/删除线/行内码/高亮/链接/标题级切换。
 * - 仅即显模式（M5 范围即显编辑体验）；源码模式选区不弹
 * - 代码块/公式/HTML 块/yaml/TOC 内选区不弹（那里没有行内格式语义，与右键菜单一致）
 * - 纯按需浮现：选区塌陷/焦点离开编辑器/按 Esc/点条外即收；滚动跟随重定位
 * - 开关：AppConfig.editor.formatBar（默认开），设置页「写作辅助」可关
 */

export interface FormatBarState {
  open: boolean
  /** 锚点（选区几何中心 x / 选区顶部与底部 y），由 FormatBar.vue 换算成条位置 */
  ax: number
  ayTop: number
  ayBottom: number
  /** 选区所在块的标题级别；非标题 = null */
  heading: number | null
  /** 选区当前已带的行内标记（按钮高亮态） */
  marks: {
    strong: boolean
    em: boolean
    strike: boolean
    code: boolean
    mark: boolean
    link: boolean
  }
  /** 所在块能否切标题（段落/标题才可以） */
  canHeading: boolean
}

export const formatBar = reactive<FormatBarState>({
  open: false,
  ax: 0,
  ayTop: 0,
  ayBottom: 0,
  heading: null,
  marks: { strong: false, em: false, strike: false, code: false, mark: false, link: false },
  canHeading: true
})

export function closeFormatBar(): void {
  formatBar.open = false
}

/** 这些块内选区不弹格式条（与右键菜单 5.8 的 BLOCKS 同语义） */
const NO_BAR_BLOCKS = new Set([
  'code_block',
  'math_block',
  'math_inline',
  'html_table',
  'yaml',
  'toc',
  'image',
  'hr'
])

/** 活动即显视图：已连接且持有焦点的最后一个 */
function activeView(): PMView | null {
  for (const v of pmViews()) {
    if (v && v.dom && v.dom.isConnected && v.hasFocus()) return v
  }
  return null
}

function selectionInBlockedNode(view: PMView): boolean {
  const { $from, $to } = view.state.selection
  type ResolvedPos = typeof $from
  const hit = ($pos: ResolvedPos): boolean => {
    for (let d = $pos.depth; d >= 0; d--) {
      if (NO_BAR_BLOCKS.has($pos.node(d).type.name)) return true
    }
    return false
  }
  return hit($from) || hit($to)
}

/** 记录当前条对应的选区（滚动重定位用） */
let selFrom = -1
let selTo = -1

function updateAnchor(view: PMView): void {
  const { from, to } = view.state.selection
  const a = view.coordsAtPos(from)
  const b = view.coordsAtPos(to)
  const left = Math.min(a.left, b.left)
  const right = Math.max(a.right, b.right)
  formatBar.ax = (left + right) / 2
  formatBar.ayTop = Math.min(a.top, b.top)
  formatBar.ayBottom = Math.max(a.bottom, b.bottom)
}

/** selectionchange 主入口：条件全过才显示，否则收起 */
function refresh(): void {
  const ui = useUiStore()
  if (ui.editorPrefs.formatBar === false) {
    if (formatBar.open) closeFormatBar()
    return
  }
  const view = activeView()
  if (!view) {
    if (formatBar.open) closeFormatBar()
    return
  }
  const sel = view.state.selection
  if (
    !(sel instanceof TextSelection) ||
    sel.empty ||
    selectionInBlockedNode(view)
  ) {
    if (formatBar.open) closeFormatBar()
    return
  }
  const { state } = view
  const M = state.schema.marks
  const { from, to } = sel
  selFrom = from
  selTo = to
  formatBar.heading = curHeadingLevel(state)
  formatBar.canHeading =
    state.selection.$from.parent.type.name === 'paragraph' ||
    state.selection.$from.parent.type.name === 'heading'
  formatBar.marks = {
    strong: M.strong ? state.doc.rangeHasMark(from, to, M.strong) : false,
    em: M.emphasis ? state.doc.rangeHasMark(from, to, M.emphasis) : false,
    strike: M.strike_through ? state.doc.rangeHasMark(from, to, M.strike_through) : false,
    code: M.inlineCode ? state.doc.rangeHasMark(from, to, M.inlineCode) : false,
    mark: M.mark ? state.doc.rangeHasMark(from, to, M.mark) : false,
    link: M.link ? state.doc.rangeHasMark(from, to, M.link) : false
  }
  updateAnchor(view)
  formatBar.open = true
}

/** 滚动时条跟随选区（滚动容器/窗口滚动都可能是 wysiwyg-host） */
function onScroll(): void {
  if (!formatBar.open) return
  const view = activeView()
  if (!view || selFrom < 0) {
    closeFormatBar()
    return
  }
  try {
    updateAnchor(view)
  } catch {
    closeFormatBar() // 选区位置已失效（文档被替换等）
  }
}

function onDocMousedown(e: MouseEvent): void {
  if (!formatBar.open) return
  const el = e.target as HTMLElement | null
  // 点在条内不收（按钮点击前不能塌陷 PM 选区；FormatBar.vue 另行 preventDefault）
  if (el?.closest?.('.fmt-bar, .fmt-bar-menu')) return
  closeFormatBar()
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && formatBar.open) closeFormatBar()
}

/** 焦点离开编辑器（设置窗/插入面板/右键输入框等抢焦点）即收 */
function onFocusin(e: FocusEvent): void {
  if (!formatBar.open) return
  const el = e.target as HTMLElement | null
  if (el?.closest?.('.ProseMirror, .fmt-bar, .fmt-bar-menu')) return
  closeFormatBar()
}

/**
 * selectionchange → PM 内部选区同步存在先后：事件触发时 PM state 还是旧值
 * （实测重挂载后首次选区读到空选区 → 条不出现，或按过期选区误开）。
 * refresh 推迟到宏任务，读到的必然是 PM 消化完 DOM 选区的新状态；
 * 连发事件自然合并，refresh 幂等。
 */
let refreshTimer = 0

function scheduleRefresh(): void {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0
    refresh()
  }, 0)
}

export function initFloatingFormatBar(): void {
  document.addEventListener('selectionchange', scheduleRefresh)
  document.addEventListener('scroll', onScroll, true)
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onDocKeydown)
  document.addEventListener('focusin', onFocusin)
  window.addEventListener('blur', closeFormatBar)
}

/* ---------- 动作 ---------- */

/** 执行条上按钮（动作后选区保留，条刷新高亮；链接走就地展开故收条） */
export function runFormatBarAction(id: string): void {
  const view = activeView()
  if (!view) {
    closeFormatBar()
    return
  }
  const s = view.state
  const M = s.schema.marks
  if (id === 'link') {
    pmToggleLink(view)
    closeFormatBar() // 地址输入框接管，条收起
    return
  }
  if (id === 'body') {
    // 显式转正文：当前在标题内 → 同级 toggle 即退正文（pmSetHeading 语义）
    const lv = curHeadingLevel(s)
    if (lv !== null) pmSetHeading(view, lv)
  } else if (/^h[1-6]$/.test(id)) {
    pmSetHeading(view, Number(id[1]))
  } else if (id === 'strong' || id === 'emphasis' || id === 'strike_through' || id === 'inlineCode' || id === 'mark') {
    const t = M[id]
    if (t) toggleMark(t)(s, view.dispatch, view)
  }
  // 文档变了，选区/标记态随新 state 刷新（选区被命令改动时 pmSetHeading 内部
  // 已重映射；这里按视图最新状态重算）
  refreshAfterAction(view)
}

function refreshAfterAction(view: PMView): void {
  const sel = view.state.selection
  if (!(sel instanceof TextSelection) || sel.empty) {
    closeFormatBar()
    return
  }
  selFrom = sel.from
  selTo = sel.to
  const { state } = view
  const M = state.schema.marks
  const { from, to } = sel
  formatBar.heading = curHeadingLevel(state)
  formatBar.marks = {
    strong: M.strong ? state.doc.rangeHasMark(from, to, M.strong) : false,
    em: M.emphasis ? state.doc.rangeHasMark(from, to, M.emphasis) : false,
    strike: M.strike_through ? state.doc.rangeHasMark(from, to, M.strike_through) : false,
    code: M.inlineCode ? state.doc.rangeHasMark(from, to, M.inlineCode) : false,
    mark: M.mark ? state.doc.rangeHasMark(from, to, M.mark) : false,
    link: M.link ? state.doc.rangeHasMark(from, to, M.link) : false
  }
  try {
    updateAnchor(view)
  } catch {
    closeFormatBar()
  }
  formatBar.open = true
}
