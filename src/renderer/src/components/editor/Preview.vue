<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ensureMath, renderWithDir } from '@/services/markdown'
import {
  applyMermaidConfigInLock,
  configMermaidFor,
  getMermaidCache,
  isHealthyMermaidSvg,
  loadMermaid,
  mermaidCacheKey,
  rethemeMermaid as rethemeMermaidConfig,
  setMermaidCache,
  withMermaidLock,
  type MermaidInstance
} from '@/services/mermaid'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { buildRegex, type FindQuery } from '@/find-shared'
import { findState, sameQuery } from '@/editor/find-state'
import { saveViewProgress, loadView } from '@/editor/tab-view-state'
import { applyCachedImageSizes, rememberImgSize } from '@/editor/img-size-cache'
import {
  applyColWidths,
  dragColumnWidth,
  getColWidths,
  hasColWidths,
  headerKeyOf,
  hitColumnBoundary,
  onColWidthsChanged,
  resetTableWidth,
  setColWidths,
  tableKey,
} from '@/editor/table-widths'

/** 列宽记忆恢复/清除（2.2）：渲染完成后把共享记忆注入表头匹配的表格；
 *  键 = 标签 + 文档内表格序号 + 表头，同名表头的表格互不影响 */
function applyStoredTableWidths(container: HTMLElement): void {
  const tables = Array.from(container.querySelectorAll('table'))
  tables.forEach((el, index) => {
    if (!(el instanceof HTMLTableElement)) return
    const w = getColWidths(tableKey(docs.activeId ?? 'x', index, headerKeyOf(el)))
    if (w) applyColWidths(el, w)
    else if (hasColWidths(el)) resetTableWidth(el)
  })
}

/** 表头列边界 hover 光标（与即显同款，rAF 节流） */
let pvCursorRaf = 0
function onPreviewMouseMoveTableCursor(e: MouseEvent): void {
  if (pvCursorRaf) return
  const x = e.clientX
  const target = e.target as HTMLElement | null
  pvCursorRaf = window.requestAnimationFrame(() => {
    pvCursorRaf = 0
    const table = target?.closest?.('table')
    if (!(table instanceof HTMLTableElement)) {
      scroller.value?.style.removeProperty('cursor')
      return
    }
    if (hitColumnBoundary(table, x) !== null)
      scroller.value?.style.setProperty('cursor', 'col-resize')
    else scroller.value?.style.removeProperty('cursor')
  })
}

/** 预览侧列宽拖拽：与即显共享同一份记忆，拖完即显侧重渲染时自动跟随 */
function onPreviewMouseDownTableWidths(e: MouseEvent): void {
  if (e.button !== 0) return
  const el = e.target as HTMLElement | null
  const table = el?.closest?.('table')
  if (!(table instanceof HTMLTableElement)) return
  const tables = Array.from(body.value?.querySelectorAll('table') ?? [])
  const index = tables.indexOf(table)
  dragColumnWidth(table, e, (widths) =>
    setColWidths(tableKey(docs.activeId ?? 'x', index, headerKeyOf(table)), widths)
  )
}
import FindBar from './FindBar.vue'
import '@/assets/preview.css'

const props = defineProps<{ content: string; docDir: string | null }>()
const emit = defineEmits<{
  (e: 'scroll-sync', line: number, frac: number, edge: ScrollEdge): void
}>()

/** 滚动到顶/底的显式信号：两侧视口高度不同，「行贴顶」模型到不了同一个端点 */
type ScrollEdge = 'top' | 'bottom' | null

const ui = useUiStore()
const scroller = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const html = ref('')

interface Block {
  /** 块首行（1 基） */
  line: number
  /** 块末行（1 基，含） */
  end: number
  top: number
  height: number
}

let blocks: Block[] = []
let lockUntil = 0
let renderTimer: number | undefined
let renderSeq = 0
/** 渲染管线是否已有排队/在跑的回合（切签滚动恢复用它决定立即落位还是等渲染） */
let renderQueued = false
/** 待恢复的共享浏览进度（0..1）；null = 无待恢复。同一文档所有模式共用一份进度 */
let pendingFrac: number | null = null
/** 下一次渲染是否禁用「内容锚点保持」（切标签/进模式时按进度或编辑器联动落位） */
let anchorSuppressed = false

/** 视口顶部的内容锚点：块行号 + 块内像素偏移。
 *  纯内容重渲染后按「同一块的同一像素偏移」恢复，避免回弹/跳动 */
type ViewAnchor = { kind: 'top' } | { kind: 'bottom' } | { kind: 'block'; line: number; offset: number }

function captureViewAnchor(): ViewAnchor | null {
  const el = scroller.value
  if (!el || el.offsetParent === null || blocks.length === 0) return null
  if (el.scrollTop <= 2) return { kind: 'top' }
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) return { kind: 'bottom' }
  let i = 0
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].top <= el.scrollTop) i = k
    else break
  }
  const cur = blocks[i]
  return { kind: 'block', line: cur.line, offset: Math.round(el.scrollTop - cur.top) }
}

function restoreViewAnchor(a: ViewAnchor): void {
  const el = scroller.value
  if (!el) return
  if (a.kind === 'top') {
    el.scrollTop = 0
    return
  }
  if (a.kind === 'bottom') {
    el.scrollTop = el.scrollHeight
    return
  }
  // 找行号相同（或其后最近的）块，保留块内像素偏移；找不到时按行号插值兜底
  let target = blocks[0]
  for (const b of blocks) {
    if (b.line <= a.line) target = b
    else break
  }
  if (!target) return
  el.scrollTop = Math.max(0, target.top + a.offset)
  lockUntil = Date.now() + 120 // 程序落位期间忽略滚动回声
}

/** 光标行可见性跟随：把行号按块内行跨度插值成块内 Y 坐标，再判断是否可见。
 *  大块（如整张表格）不能按块底判断——否则光标在表头时会把表尾滚进视口 */
function ensureLineVisible(line: number): void {
  const el = scroller.value
  if (!el || el.offsetParent === null || blocks.length === 0) return
  let target = blocks[0]
  for (const b of blocks) {
    if (b.line <= line) target = b
    else break
  }
  if (!target) return
  const span = Math.max(1, target.end - target.line)
  const f = Math.min(1, Math.max(0, (line - target.line) / span))
  const y = target.top + f * target.height
  const viewTop = el.scrollTop
  const viewH = el.clientHeight
  const margin = 24
  if (y >= viewTop + 8 && y <= viewTop + viewH - margin) return
  // 目标行不可见：放到视口上约 1/3 处，让上下文可见
  const maxTop = Math.max(0, el.scrollHeight - viewH)
  el.scrollTop = Math.max(0, Math.min(maxTop, y - viewH * 0.34))
  lockUntil = Date.now() + 120
}

let caretEnsureTimer = 0
/* 源码光标/内容变化（同一行连续输入也会触发）→ 稍等渲染完成后保证该行在预览视口内 */
watch(
  () => ui.caretSeq,
  () => {
    if (ui.editorMode !== 'split') return
    const line = ui.currentLine
    window.clearTimeout(caretEnsureTimer)
    caretEnsureTimer = window.setTimeout(() => {
      if (ui.editorMode === 'split') ensureLineVisible(line)
    }, 220)
  }
)

/* ---------- 图片尺寸缓存：共享实现见 editor/img-size-cache.ts ---------- */

watch(
  () => props.content,
  (content) => {
    window.clearTimeout(renderTimer)
    // 大文档全文重渲染一次要几百毫秒，防抖拉长避免连续输入时卡顿
    const delay = content.length > 200_000 ? 450 : 120
    renderQueued = true
    renderTimer = window.setTimeout(() => void render(content), delay)
  },
  { immediate: true }
)

/** 换文档（docDir 变化）时立即重渲染：图片相对路径才能正确解析。
 *  滚动位置交给每标签视图状态恢复（切标签 watch），不再一律回顶 */
watch(
  () => props.docDir,
  () => {
    renderQueued = true
    void render(props.content)
  }
)

/** 恢复共享浏览进度落位（切签/模式进入/图片加载后反复调用直至收敛） */
function applyPendingScroll(): void {
  const el = scroller.value
  if (pendingFrac === null || !el) return
  el.scrollTop = pendingFrac * Math.max(0, el.scrollHeight - el.clientHeight)
}

/** 顶层块的源码行范围：行号标记多数直接在块上；代码块在 .md-code 容器内
 *  （标记在内层 <code> 上）、居中块在 .md-center 内——从后代取，取不到
 *  （如脚注区）返回 null。start/end 为 0 基，end 为排他边界 */
function blockLineRange(el: HTMLElement): [number, number] | null {
  const self = el.dataset.sourceLine
  if (self !== undefined) {
    const end = Number(el.dataset.sourceLineEnd)
    return [Number(self), Number.isFinite(end) ? end : Number(self)]
  }
  const inners = el.querySelectorAll<HTMLElement>('[data-source-line]')
  if (inners.length === 0) return null
  const first = inners[0]
  const last = inners[inners.length - 1]
  const end = Number(last.dataset.sourceLineEnd)
  return [Number(first.dataset.sourceLine), Number.isFinite(end) ? end : Number(last.dataset.sourceLine)]
}

/** 连续空行可视间距：markdown 规范会把多个空行塌缩成一个段落间隙，
 *  但纸面观感要求「源里空几行，页面上就空几行」——统计两块之间源码里
 *  真正空白的行数（脚注定义这类被渲染管线挪走的行不是空行，不算），
 *  把超出一行的部分插成定高占位（首行空隙仍由段落 margin 承担）。
 *  必须在 collectBlocks 之前调用，块映射与切签锚点才拿得到最终布局 */
function applyBlankGaps(): void {
  const root = body.value
  if (!root) return
  root.querySelectorAll('.blank-gap').forEach((el) => el.remove())
  const rawLines = props.content.split('\n')
  let prevEnd: number | null = null
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const range = blockLineRange(el)
    if (!range) continue // 无行信息的区块（脚注区等）：跳过且不更新边界
    const [start, end] = range
    if (prevEnd !== null && start > prevEnd) {
      // 只统计连续空行的最大段：空行被非空行（脚注定义等渲染时挪走的行）
      // 隔开时是两个独立的单空行，不叠加
      let maxRun = 0
      let run = 0
      for (let i = prevEnd; i < start && i < rawLines.length; i++) {
        if (rawLines[i].trim()) {
          run = 0
        } else {
          run++
          if (run > maxRun) maxRun = run
        }
      }
      if (maxRun > 1) {
        const style = getComputedStyle(el)
        const lh = parseFloat(style.lineHeight)
        const lineH = Number.isFinite(lh) && lh > 0 ? lh : parseFloat(style.fontSize) * 1.6
        const gap = document.createElement('div')
        gap.className = 'blank-gap'
        gap.setAttribute('aria-hidden', 'true')
        gap.style.height = `${(maxRun - 1) * lineH}px`
        el.parentNode?.insertBefore(gap, el)
      }
    }
    prevEnd = end
  }
}

/** 主题切换 → 只重渲染 mermaid 图表：其余内容的颜色全走 CSS 变量，
 *  [data-theme] 切换即自动跟随，无需重建 DOM。图表颜色是渲染时内联的，
 *  在离屏节点按新主题画好再原地替换——无占位塌陷、无闪烁、滚动不丢。
 *  （不能用清空 html 重建的路子：整页闪一下 + 滚动位置丢失；
 *  也不能移除 data-processed 原地重跑：run 会把 SVG 内部文本当源码） */
watch(
  () => ui.effectiveTheme,
  () => {
    rethemeMermaidConfig(ui.effectiveTheme === 'dark')
    void rethemeMermaid()
  }
)

/** 主题切换时清空待渲染队列：队列里的节点尚未出图（无 data-mermaid-src，
 *  rethemeMermaid 会跳过），若不打断，它们会以旧极性在后台泳道画出来——
 *  「流程图浅色、时序图深色」同屏混排的根因。清空后由 rethemeMermaid 的
 *  later 分支重新入队，按新极性渲染 */
function resetMermaidQueueForTheme(): void {
  mermaidQueue.length = 0
  disconnectMermaidObserver()
}

let rethemeSeq = 0

/** 主题令牌变化（换主题/改变体）：重配置 + 重绘图表。
 *  与 effectiveTheme 的 watch 互补——同明暗换主题时前者不触发 */
function onThemeApplied(): void {
  rethemeMermaidConfig(ui.effectiveTheme === 'dark')
  void rethemeMermaid()
}

/** 主题切换：视口内的图离屏按新主题重绘后原地替换（无闪烁）；
 *  视口外的回到占位态入后台队列慢慢补——mermaid 的 run 是全局配置串行的，
 *  两百张图全量重绘要一分多钟，首屏可见的先换色才是用户关心的 */
async function rethemeMermaid(): Promise<void> {
  resetMermaidQueueForTheme()
  const nodes = [...(body.value?.querySelectorAll<HTMLElement>('.mermaid') ?? [])]
  if (nodes.length === 0) return
  const seq = ++rethemeSeq
  let m: MermaidInstance | null
  try {
    m = await loadMermaid(ui.effectiveTheme === 'dark')
  } catch (err) {
    console.error('[preview] mermaid load failed:', err)
    return
  }
  if (!m) return
  const host = body.value
  const view = scroller.value?.getBoundingClientRect()
  const offs: { node: HTMLElement; off: HTMLElement; key: string }[] = []
  const later: HTMLElement[] = []
  for (const node of nodes) {
    if (seq !== rethemeSeq) return // 主题连切：本轮作废
    if (!node.isConnected) continue
    const code = node.dataset.mermaidSrc ?? ''
    if (!code) {
      // 从未渲染过的占位（源码就是 textContent）：队列已被本轮清空、observer
      // 已断开，若直接跳过它将永远没人渲染——入队交给常规流程补齐
      later.push(node)
      continue
    }
    const key = mermaidCacheKey(code, ui.effectiveTheme === 'dark')
    const hit = getMermaidCache(key)
    if (hit !== undefined) {
      node.innerHTML = hit
      node.setAttribute('data-processed', 'true')
      continue
    }
    const r = node.getBoundingClientRect()
    const visible = view && r.bottom > view.top && r.top < view.bottom
    if (visible) {
      // 离屏节点：同宽度、脱离文档流（mermaid 测量需要布局），完成后替换
      const off = document.createElement('div')
      off.style.cssText = `position:absolute;left:-9999px;top:0;width:${node.clientWidth || 600}px`
      off.textContent = code
      host?.appendChild(off)
      offs.push({ node, off, key })
    } else {
      later.push(node)
    }
  }
  if (offs.length > 0) {
    let requeued = 0
    try {
      await withMermaidLock(async () => {
        applyMermaidConfigInLock(ui.effectiveTheme === 'dark')
        await m.run({ nodes: offs.map((o) => o.off), suppressErrors: true })
      })
    } catch (err) {
      console.error('[preview] mermaid retheme failed:', err)
    }
    for (const { node, off, key } of offs) {
      // 健康校验：退化/错误图不落位不缓存（占位回队列重试），不标 processed
      if (isHealthyMermaidSvg(off.querySelector('svg')) && off.isConnected) {
        node.innerHTML = off.innerHTML
        node.setAttribute('data-processed', 'true')
        setMermaidCache(key, off.innerHTML)
      } else if (node.isConnected) {
        node.removeAttribute('data-processed')
        node.textContent = node.dataset.mermaidSrc ?? ''
        mermaidQueue.push(node)
        requeued++
      }
      off.remove()
    }
    if (requeued > 0) void pumpMermaidQueue(m)
  }
  if (seq !== rethemeSeq) return
  for (const node of later) {
    node.removeAttribute('data-processed')
    // 已渲染节点还原源码占位（textContent 曾被 SVG 顶替）；从未渲染的占位
    // textContent 本身就是源码，不能清空（mermaidSrc 属性不存在）
    const src = node.dataset.mermaidSrc
    if (src) node.textContent = src
    mermaidQueue.push(node)
  }
  if (later.length > 0) void pumpMermaidQueue(m)
  collectBlocks()
}

/** 就地修补预览容器：解析新 HTML，把其中 img / mermaid 占位用旧树里渲染完成的
 *  同源节点顶替（key：img→src、mermaid→data-mermaid-src），再一次性替换子树。
 *  全量 v-html 重建会让图片重新解码、图表回退占位——双栏打字时表现为预览频繁闪动 */
function swapPreviewHtml(container: HTMLElement, nextHtml: string): void {
  const tpl = document.createElement('template')
  tpl.innerHTML = nextHtml
  const keyOf = (el: Element): string | null => {
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src')
      return src ? `img:${src}` : null
    }
    if (el.classList.contains('mermaid')) {
      // 旧节点读渲染时存档的源码；新占位符没有该属性，其文本就是源码——两者同源
      const code = el.getAttribute('data-mermaid-src') ?? (el as HTMLElement).dataset.mermaidSrc ?? el.textContent ?? ''
      return code ? `mm:${code}` : null
    }
    return null
  }
  const keep = new Map<string, Element>()
  container.querySelectorAll('img, .mermaid').forEach((el) => {
    const k = keyOf(el)
    if (k && !keep.has(k)) keep.set(k, el)
  })
  if (keep.size > 0) {
    tpl.content.querySelectorAll('img, .mermaid').forEach((el) => {
      const k = keyOf(el)
      const old = k ? keep.get(k) : undefined
      if (k && old) {
        el.replaceWith(old)
        keep.delete(k)
      }
    })
  }
  container.replaceChildren(tpl.content)
}

async function render(content: string): Promise<void> {
  const seq = ++renderSeq
  // 纯内容重渲染（输入触发）前记录视口锚点：换 DOM 后按内容位置恢复，
  // 避免被重新对齐到源码行造成「回弹」；切签/进模式由 anchorSuppressed 关闭
  const anchor = anchorSuppressed ? null : captureViewAnchor()
  anchorSuppressed = false
  // 换 DOM 期间 scrollHeight 会短暂塌缩，scroll 事件可能把 scrollTop 钳到 0；
  // 这种回声不能冒发给编辑器（否则源码跳到顶部 → 联动又把预览带回顶部）。
  // 整段替换/恢复期间加锁，等落位完成后解锁。
  lockUntil = Date.now() + 350
  await ensureMath(content)
  if (seq !== renderSeq) return
  const nextHtml = content.trim() ? renderWithDir(content, props.docDir) : ''
  html.value = nextHtml
  await nextTick()
  // 关闸：等待期间若又开始了新渲染，本轮作废——否则陈旧回合会在
  // 新一轮已渲染完的 DOM 上重跑 mermaid（把 SVG 内的 <style> 文本当源码）
  if (seq !== renderSeq) return
  // v-html 已移除：容器由 v-if 创建但内容走就地修补（图片/图表不重建不闪动）
  if (nextHtml && body.value) swapPreviewHtml(body.value, nextHtml)
  applyBlankGaps() // 空行占位先插入，块映射与切签锚点才拿得到最终布局
  if (body.value) applyCachedImageSizes(body.value) // 图片占位尺寸先落位，块映射与切签锚点才不会按塌缩布局算
  if (body.value) applyStoredTableWidths(body.value) // 列宽记忆（2.2）：与即显共享
  collectBlocks()
  applyPvFocus() // DOM 重建后重放双栏联动高亮（光标没动就不需要等下一次 emit）
  renderQueued = false
  if (pendingFrac !== null) applyPendingScroll() // 切签滚动恢复：DOM 换完即落位
  else if (anchor) restoreViewAnchor(anchor) // 输入触发重渲染：保持原内容锚点
  await renderMermaid()
  // 内容重渲染重置了 DOM，开着查找就重扫；恢复标签状态后的首次重扫不滚动定位
  if (findOpen.value) {
    const prevActive = findActive.value
    pvSearch(locateNextSearch)
    // 恢复场景：一次性补回切签前的活动项（x/x）
    if (restoreActiveOnce >= 0 && findHits.length > 0) {
      findActive.value = Math.min(restoreActiveOnce, findHits.length - 1)
      pvShowHit(findActive.value, false)
      restoreActiveOnce = -1
    } else if (findHits.length > 0 && prevActive >= 0) {
      // 查询没变的重扫（输入触发的重渲染）保持原活动项而不是归零：
      // 归零值会被推回共享槽位，把源码侧的 x/x 一起拽回 1
      findActive.value = Math.min(prevActive, findHits.length - 1)
      pvShowHit(findActive.value, false)
    }
  }
  locateNextSearch = true
}

/* mermaid 主题配置/缓存/加载已抽至 services/mermaid.ts（预览与即显共用） */



/* ---------- mermaid 视口懒渲染 ----------
 * mermaid 的 run 是串行的且共享全局配置（并发 run 会互相踩），
 * 大文档几十上百张图全量渲染会卡住主线程一分多钟。
 * 策略：视口内（含 600px 余量）立即渲染，视口外的注册 IntersectionObserver，
 * 滚动到附近才入队；后台队列串行消费，渲染完成后延迟合并重收集块映射。 */

let mermaidObserver: IntersectionObserver | null = null
const mermaidQueue: HTMLElement[] = []
let mermaidPumping = false
let collectTimer: number | undefined

/** 块映射延迟重收集（每张图渲染后高度都会变，合并成一次） */
function scheduleCollect(): void {
  window.clearTimeout(collectTimer)
  collectTimer = window.setTimeout(() => collectBlocks(), 150)
}

function disconnectMermaidObserver(): void {
  mermaidObserver?.disconnect()
  mermaidObserver = null
}

/** 离屏渲染一段 mermaid 源码为 svg HTML（body 直挂 + 显式宽度）。
 *  不在预览面板内就地渲染：模式切换/挂载窗口内面板宽度会瞬时塌缩为 0，
 *  flowchart-v2 依赖容器宽度测量，就地渲染会得到 0×0 退化空图（序列图
 *  不依赖容器宽度，幸免——这正是"流程图空白、序列图正常"的由来）。
 *  离屏渲染与面板布局状态完全解耦（即显 nodeView 同款方案，全天零失败）；
 *  useMaxWidth 的 svg 注入面板后自适应实际宽度。
 *  健康校验（退化/错误图=失败）+ 失败重试一次。 */
async function renderMermaidOffscreen(
  m: MermaidInstance,
  code: string,
  width: number
): Promise<string | null> {
  let out: string | null = null
  for (let attempt = 0; attempt < 2 && out === null; attempt++) {
    const holder = document.createElement('div')
    holder.style.cssText = `position:absolute;left:-9999px;top:0;width:${width}px`
    holder.textContent = code
    document.body.appendChild(holder)
    try {
      await withMermaidLock(async () => {
        // run 读「执行时刻」的全局配置：排队期间主题翻转的话，轮次开头的
        // configMermaidFor 已过期——锁内按当下极性重应用，保证不串色
        applyMermaidConfigInLock(ui.effectiveTheme === 'dark')
        await m.run({ nodes: [holder], suppressErrors: true })
      })
    } catch {
      /* 失败在下方统一降级 */
    }
    if (isHealthyMermaidSvg(holder.querySelector('svg'))) out = holder.innerHTML
    holder.remove()
  }
  return out
}

/** 渲染单个占位节点：缓存命中同步替换，否则离屏渲染 + 归档/降级 */
async function renderMermaidNode(m: MermaidInstance, node: HTMLElement): Promise<void> {
  if (!node.isConnected || node.getAttribute('data-processed') === 'true') return
  const code = node.textContent ?? ''
  const key = mermaidCacheKey(code, ui.effectiveTheme === 'dark')
  const hit = getMermaidCache(key)
  if (hit !== undefined) {
    node.innerHTML = hit
    node.setAttribute('data-processed', 'true')
    // 源码存档：主题切换的离屏重渲染（rethemeMermaid）凭它还原占位输入
    node.setAttribute('data-mermaid-src', code)
    scheduleCollect()
    return
  }
  const paneW = node.closest('.md-preview')?.clientWidth ?? 0
  const darkAtStart = ui.effectiveTheme === 'dark'
  const html = await renderMermaidOffscreen(m, code, Math.max(paneW, node.clientWidth, 320))
  if (!node.isConnected) return
  // 渲染期间主题翻转：成品是旧极性（缓存键也已错位）——按新极性重排本节点
  if ((ui.effectiveTheme === 'dark') !== darkAtStart) {
    node.removeAttribute('data-processed')
    mermaidQueue.push(node)
    return
  }
  if (html !== null) {
    node.innerHTML = html
    node.setAttribute('data-processed', 'true')
    node.setAttribute('data-mermaid-src', code)
    setMermaidCache(key, html)
  } else {
    // 渲染失败的节点：还原源码展示
    node.classList.add('mermaid-error')
    node.setAttribute('data-mermaid-src', code)
    node.textContent = code
  }
  scheduleCollect()
}

/** 后台队列串行消费（全局配置互斥，不能并发 run） */
async function pumpMermaidQueue(m: MermaidInstance): Promise<void> {
  if (mermaidPumping) return
  mermaidPumping = true
  try {
    while (mermaidQueue.length > 0) {
      const node = mermaidQueue.shift()!
      await renderMermaidNode(m, node)
    }
  } finally {
    mermaidPumping = false
  }
}

/** 视口外的占位图进入余量范围 → 入队渲染 */
function getMermaidObserver(m: MermaidInstance): IntersectionObserver {
  mermaidObserver ??= new IntersectionObserver(
    (entries) => {
      let hit = false
      for (const en of entries) {
        if (!en.isIntersecting) continue
        mermaidObserver?.unobserve(en.target)
        mermaidQueue.push(en.target as HTMLElement)
        hit = true
      }
      if (hit) void pumpMermaidQueue(m)
    },
    { root: scroller.value, rootMargin: '600px 0px' }
  )
  return mermaidObserver
}

/** 视口内（含余量）判断 */
function nearViewport(node: HTMLElement, marginPx: number): boolean {
  const view = scroller.value?.getBoundingClientRect()
  if (!view) return true
  const r = node.getBoundingClientRect()
  return r.bottom > view.top - marginPx && r.top < view.bottom + marginPx
}

async function renderMermaid(): Promise<void> {
  const nodes = body.value?.querySelectorAll<HTMLElement>('.mermaid')
  if (!nodes || nodes.length === 0) return
  // 每轮渲染前都应用当前主题配置：initialize 只是设配置对象，开销可忽略。
  // 不能只靠"首次加载/切主题时"调用——组件 HMR 重挂载不触发主题 watch，
  // 实例会一直用旧配置渲染（曾导致改配色后用户侧图表纹丝不动）
  configMermaidFor(ui.effectiveTheme === 'dark')
  let m: MermaidInstance | null
  try {
    m = await loadMermaid(ui.effectiveTheme === 'dark')
  } catch (err) {
    console.error('[preview] mermaid load failed:', err)
    return
  }
  if (!m) return
  // 内容已换新 DOM：旧的观察全部作废（观察的是已断开的节点）
  disconnectMermaidObserver()
  const observer = getMermaidObserver(m)
  let immediate = 0
  for (const node of [...nodes]) {
    if (!node.isConnected) continue
    // 已渲染过的节点直接跳过：陈旧渲染回合摸到的都是上一轮成品，
    // 重跑会把 SVG 里的 <style> 文本当源码解析（切主题后图表变 CSS 文字的根因）
    if (node.getAttribute('data-processed') === 'true') continue
    if (nearViewport(node, 600)) {
      mermaidQueue.push(node)
      immediate++
    } else {
      observer.observe(node)
    }
  }
  if (immediate > 0) await pumpMermaidQueue(m)
  else collectBlocks()
}

/* ---------- 同步滚动 ---------- */

function collectBlocks(): void {
  if (!body.value) return
  /* top 用 rect 差值而非 offsetTop：offsetTop 相对最近的定位祖先，块内一旦
     出现 relative 容器（如曾经的 .md-code）就会退化为局部坐标，滚动映射
     整段跳变；rect 差值对任何中间定位祖先免疫。
     img 也带 data-source-line（双栏联动高亮用），但它总在带标记的段内，
     收进来只会产生同顶重复块，且 img 无 data-source-line-end 会算出 NaN
     的 end——这里跳过所有 img，联动高亮走自己的 img[data-source-line] 查询 */
  const bodyTop = body.value.getBoundingClientRect().top
  blocks = [...body.value.querySelectorAll<HTMLElement>('[data-source-line]')]
    .filter((el) => el.tagName !== 'IMG')
    .map((el) => {
      const line = Number(el.dataset.sourceLine) + 1
      const endAttr = Number(el.dataset.sourceLineEnd)
      return {
        line,
        end: Number.isFinite(endAttr) ? Math.max(line, endAttr) : line,
        top: el.getBoundingClientRect().top - bodyTop,
        height: el.offsetHeight
      }
    })
  // 脚注区补锚：markdown-it-footnote 的 section 没有 data-source-line
  // （脚注定义在源码文末），不补的话源码滚到脚注定义区时预览停在最后
  // 一个正文块，两边失同步。锚到文档总行数：源码滚到底 ↔ 预览滚到脚注区
  const foot = body.value.querySelector<HTMLElement>('.footnotes')
  if (foot) {
    const totalLines = props.content ? props.content.split('\n').length : 1
    blocks.push({
      line: totalLines,
      end: totalLines,
      top: foot.getBoundingClientRect().top - bodyTop,
      height: foot.offsetHeight
    })
  }
}

/** 视口顶所在块（top 为块的容器内容坐标） */
function blockAtScrollTop(st: number): { i: number; f: number } {
  let i = 0
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].top <= st + 6) i = k
    else break
  }
  const cur = blocks[i]
  const next = blocks[i + 1]
  const span = next ? next.top - cur.top : Math.max(1, cur.height)
  const f = Math.min(1, Math.max(0, (st + 6 - cur.top) / span))
  return { i, f }
}

/* 预览滚动 → 通知编辑器：块内按行跨度插值出行号；
   顶/底边缘发显式信号（两侧视口高度不同，插值模型到不了同一端点） */
function edgeOf(el: HTMLElement): ScrollEdge {
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) return 'bottom'
  if (el.scrollTop <= 2) return 'top'
  return null
}

function onScrollDom(): void {
  if (Date.now() < lockUntil) return
  // 能过锁的都是用户直接滚动（程序滚动的回声被 lockUntil 挡住）：
  // 接管后作废旧锚，图片加载不再把预览拽回旧位置；浏览进度持续写入
  lastSyncLine = null
  const el = scroller.value
  if (!el) return
  saveViewProgress(
    docs.activeId,
    el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)
  )
  if (blocks.length === 0) return
  const edge = edgeOf(el)
  if (edge) {
    emit('scroll-sync', edge === 'bottom' ? Number.MAX_SAFE_INTEGER : 0, 0, edge)
    return
  }
  const { i, f } = blockAtScrollTop(el.scrollTop)
  const cur = blocks[i]
  const next = blocks[i + 1]
  const lineSpan = next ? next.line - cur.line : Math.max(1, cur.end - cur.line)
  emit('scroll-sync', cur.line + f * lineSpan, 0, null)
}

/* 编辑器滚动 → 同步预览：目标行落在哪个块内，块内按高度比例插值；
   顶/底边缘信号直接对齐端点（编辑器底部有 40vh 内边距，插值模型
   两侧「滚到底」的最大滚动量不一致，必须显式对齐） */
/** 最近一次源码侧同步的目标行：图片加载撑高预览后，按它把预览重新对齐。
 *  用户直接滚动预览即接管（置 null），此后图片加载不再往旧锚上拽 */
let lastSyncLine: number | null = null

function syncToLine(line: number, frac: number, edge: ScrollEdge = null): void {
  const el = scroller.value
  if (!el || blocks.length === 0) return
  // frac 是源码侧视口顶行内的像素比例（0 基小数）：并入目标行做亚行插值。
  // 图片密集区左右行高差异巨大（左 20px/行、右一整张图），只按整数行对齐
  // 会让预览一格格跳图片；带上亚行偏移才跟得上左边的连续滚动
  const target = edge ? line : line + Math.min(1, Math.max(0, frac))
  lastSyncLine = edge ? null : target
  lockUntil = Date.now() + 120
  if (edge === 'bottom') {
    el.scrollTop = el.scrollHeight
    return
  }
  if (edge === 'top') {
    el.scrollTop = 0
    return
  }
  let i = 0
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].line <= target) i = k
    else break
  }
  const cur = blocks[i]
  const next = blocks[i + 1]
  const lineSpan = next ? next.line - cur.line : Math.max(1, cur.end - cur.line)
  const f = Math.min(1, Math.max(0, (target - cur.line) / lineSpan))
  const topSpan = next ? next.top - cur.top : Math.max(1, cur.height)
  el.scrollTop = Math.max(0, cur.top + f * topSpan - 6)
}

defineExpose({ syncToLine, focusImage })

/* ---------- 双栏联动：光标所在图片语法 → 对应图高亮 ---------- */

/** 图片 <img> 带所在精确行（markdown.ts 渲染时打 data-source-line,0 基） */
let pvFocus: { line: number; k: number } | null = null

/** 源码光标落在图片语法上时由 EditorArea 调用（line=null 撤高亮）；
 *  行号 1 基,k 为同行第几张（同段多图按源码出现序 = DOM 顺序对应） */
function focusImage(line: number | null, k = 0): void {
  pvFocus = line === null ? null : { line, k }
  applyPvFocus()
}

function applyPvFocus(): void {
  const root = body.value
  if (!root) return
  root.querySelectorAll('.pv-img-focus').forEach((el) => el.classList.remove('pv-img-focus'))
  if (!pvFocus) return
  const imgs = root.querySelectorAll<HTMLElement>(`img[data-source-line="${pvFocus.line - 1}"]`)
  imgs[pvFocus.k]?.classList.add('pv-img-focus')
}

/* ---------- 查找（预览只读：DOM 高亮定位，无替换） ---------- */

const findOpen = ref(false)
const findQuery = ref<FindQuery>({ text: '', caseSensitive: false, regexp: false, wholeWord: false })
const findCount = ref(0)
const findActive = ref(-1)
const findError = ref(false)
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)
/** 当前命中元素（v-html 内容重渲染后由 pvSearch 重建） */
let findHits: HTMLElement[] = []
let findSeq = 0

/** 查找状态按「标签」共享（同一文档四模式一份）：refs 当前属于哪个标签 */
const docs = useDocumentsStore()
const findTabId = ref<number | null>(null)
/** 拉回共享槽位期间抑制 findQuery watcher 的重扫（拉回自己做显式重扫） */
let findSyncing = false
/** 拉回/切标签后的首次重扫只重建高亮、不滚动定位（切回来不该跳走） */
let locateNextSearch = true
/** 恢复的活动项（0 基；-1 = 无）：渲染重扫会把活动项重置为 0，
 *  用此标志在重扫后一次性补回原来的 x/x 显示 */
let restoreActiveOnce = -1

/** refs → 标签槽。active 归「显示查找条的一侧」所有：双栏下查找条属于源码侧，
 *  预览只跟随（本地钳位做高亮）不回写——两种表示命中数可以不同（源码 2 处、
 *  渲染后 1 处），回写钳位值会把源码侧的 x/x 拽小；预览模式独占条时才拥有 */
function pushFind(): void {
  const st = findState(findTabId.value)
  const own = ui.editorMode === 'preview'
  if (
    st.open === findOpen.value &&
    sameQuery(st.query, findQuery.value) &&
    (!own || st.active === findActive.value)
  ) {
    return
  }
  st.open = findOpen.value
  st.query = { ...findQuery.value }
  if (own) st.active = findActive.value
}

/** 标签槽 → refs：切标签/挂载/双栏另一侧改了共享状态；高亮重扫不滚动 */
function pullFind(id: number | null, force = false): void {
  const st = findState(id)
  if (
    !force &&
    st.open === findOpen.value &&
    sameQuery(st.query, findQuery.value) &&
    st.active === findActive.value
  ) {
    findTabId.value = id
    return
  }
  findTabId.value = id
  findSyncing = true
  findOpen.value = st.open
  findQuery.value = { ...st.query }
  if (st.open) {
    locateNextSearch = false // 排队中的渲染重扫不跳到第一处命中
    // 渲染排队中 body 还是上一篇文档的内容，此时重扫只会数出错误命中并把
    // 脏 active 推回共享槽位——跳过，等 render 完成后的重扫（带恢复标志）
    if (!renderQueued) pvSearch(false)
    // 恢复原来的活动项（x/x 显示）：重扫后钳到有效范围并补高亮类。
    // 标志无条件记住——挂载时 DOM 未渲染（hits 空），渲染重扫后仍要补回
    restoreActiveOnce = Math.max(st.active, -1)
    if (findHits.length > 0 && restoreActiveOnce >= 0) {
      findActive.value = Math.min(restoreActiveOnce, findHits.length - 1)
      pvShowHit(findActive.value, false)
    }
  } else {
    locateNextSearch = true
    restoreActiveOnce = -1
    pvClearHighlights() // 关闭状态：清掉旧标签残留在 DOM 上的高亮
    findCount.value = 0
    findActive.value = -1
  }
  void nextTick(() => {
    findSyncing = false
  })
}

function pvClearHighlights(): void {
  const root = body.value
  if (!root) return
  root.querySelectorAll('.pv-find-hit').forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent ?? ''))
  })
  root.normalize() // 合并被拆开的相邻文本节点，避免下轮匹配错位
  findHits = []
}

/** 全文收集文本节点（跳过图表/公式），命中包一层高亮 span。
 *  locate=false 只重建高亮不滚动定位（恢复标签状态/渲染重扫时用） */
function pvSearch(locate = true): void {
  const root = body.value
  if (!root) return
  const seq = ++findSeq
  pvClearHighlights()
  const q = findQuery.value
  if (q.regexp) {
    try {
      new RegExp(q.text, q.caseSensitive ? '' : 'i')
      findError.value = false
    } catch {
      findError.value = true
    }
  } else {
    findError.value = false
  }
  if (!q.text || findError.value) {
    findCount.value = 0
    findActive.value = -1
    return
  }
  const re = buildRegex(q)
  if (!re) {
    findError.value = true
    findCount.value = 0
    return
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement
      if (!p || !n.nodeValue) return NodeFilter.FILTER_REJECT
      if (p.closest('.mermaid, .katex, script, style, .pv-find-hit')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  const hits: HTMLElement[] = []
  for (const node of texts) {
    if (seq !== findSeq) return // 期间内容重渲染：本轮作废
    const text = node.nodeValue ?? ''
    re.lastIndex = 0
    const ranges: [number, number][] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (!m[0]) {
        re.lastIndex++ // 零宽匹配防死循环
        continue
      }
      ranges.push([m.index, m.index + m[0].length])
      if (ranges.length >= 500) break
    }
    if (!ranges.length) continue
    const frag = document.createDocumentFragment()
    let last = 0
    for (const [s, e] of ranges) {
      if (s > last) frag.appendChild(document.createTextNode(text.slice(last, s)))
      const span = document.createElement('span')
      span.className = 'pv-find-hit'
      span.textContent = text.slice(s, e)
      frag.appendChild(span)
      hits.push(span)
      last = e
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }
  findHits = hits
  findCount.value = hits.length
  findActive.value = hits.length ? 0 : -1
  if (hits.length && locate) pvShowHit(0)
}

function pvShowHit(i: number, locate = true): void {
  findHits.forEach((el, k) => el.classList.toggle('pv-find-hit-active', k === i))
  // scrollIntoView 不依赖焦点，预览面板无焦点也能定位
  if (locate) findHits[i]?.scrollIntoView({ block: 'center' })
}

function pvNav(dir: 1 | -1): void {
  if (!findHits.length) return
  findActive.value = (findActive.value + dir + findHits.length) % findHits.length
  pvShowHit(findActive.value)
}

function pvClose(): void {
  findOpen.value = false
  pvClearHighlights()
  findCount.value = 0
  findActive.value = -1
}

watch(findQuery, () => {
  if (findSyncing) return // 拉回共享状态不是一次新查询
  if (findOpen.value) pvSearch()
})

/* refs → 共享槽位：查找条开关/查询词/活动项变化即推送（双栏另一侧/其他模式同步读取） */
watch([findOpen, findQuery, findActive], () => {
  if (findSyncing) return
  pushFind()
})

/* 共享槽位 → refs：切标签/挂载/双栏另一侧改了同一标签的查找状态 */
watch(
  () => {
    const st = findState(findTabId.value)
    return [st.open, st.query.text, st.query.caseSensitive, st.query.regexp, st.query.wholeWord, st.active] as const
  },
  () => {
    if (findSyncing) return
    pullFind(findTabId.value)
  }
)

/** 切换标签：旧标签滚动进度落袋，恢复目标标签自己的进度与查找状态（共享槽位） */
watch(
  () => docs.activeId,
  (id, old) => {
    // 直接读 DOM（docDir watch 已不抢先归零；遮挡窗口下 scroll 事件会被
    // Chromium 节流掉，靠事件跟踪会拿到陈旧值）。
    // 隐藏窗格（编辑模式下预览隐藏）scrollTop 恒 0，跳过保存保留旧值
    const el = scroller.value
    if (el && el.offsetParent !== null) {
      saveViewProgress(old, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight))
    }
    pendingFrac = loadView(id)?.frac ?? null
    lastSyncLine = null
    anchorSuppressed = true // 切签按进度落位，不保留上一标签的视口锚点
    pullFind(id, true)
    void nextTick(() => {
      if (!renderQueued) applyPendingScroll() // 内容相同没有重渲染排队时也要落位
    })
  }
)

/* 进入预览可见模式（预览/双栏）：对齐共享浏览进度——其它模式滚过的位置
   就是预览的位置；进度渲染期间由 applyPendingScroll 在渲染/图片加载后钉住。
   落位多阶段补拍（nextTick/60ms/250ms）：面板刚转可见与测量的时序有竞态 */
watch(
  () => ui.editorMode,
  (m) => {
    if (m !== 'preview' && m !== 'split') return
    anchorSuppressed = true // 进入可见模式按共享进度落位，不保留隐藏期的旧锚点
    // 读进度必须延迟到 nextTick：同一 flush 里「离开中的窗格」的落袋保存
    // 发生在父组件渲染期间（v-if 卸载的 beforeUnmount），watcher 触发时它
    // 还没执行——此刻读会拿到上一次的旧值甚至空值
    void nextTick(() => {
      pendingFrac = loadView(docs.activeId)?.frac ?? null
      const apply = (): void => {
        applyPendingScroll()
        const el = scroller.value
        if (el) lockUntil = Date.now() + 150
      }
      void nextTick(apply)
      window.setTimeout(apply, 60)
      window.setTimeout(() => {
        apply()
        // 进入 split 后进度由编辑器（联动主导方）持续写入，对齐完成即清空；
        // 进入 preview 模式则保留 pendingFrac，图片加载期间继续按它钉住
        if (m === 'split') pendingFrac = null
      }, 250)
    })
  }
)

/* 预览模式 Ctrl+F：只搜索定位，不做替换（不再切回双栏） */
watch(
  () => ui.findRequest,
  () => {
    if (ui.editorMode !== 'preview') return
    findOpen.value = true
    pvSearch()
    void nextTick(() => findBarRef.value?.focusInput())
  }
)

/* 进入预览/双栏：面板可能一直挂载着没重渲染（内容未变），补一次列宽重放 */
watch(
  () => ui.editorMode,
  async (m) => {
    if (m !== 'preview' && m !== 'split') return
    await nextTick()
    if (body.value) applyStoredTableWidths(body.value)
  }
)

/* ---------- 图片点击 → 查看器 ---------- */

function onClickDom(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG' && target.parentElement?.closest('.md-preview')) {
    e.preventDefault()
    ui.viewerImage = (target as HTMLImageElement).src
  }
}

let resizeObserver: ResizeObserver | undefined
let offTableWidths: (() => void) | null = null

/** 图片加载完成会撑高预览（加载前 img 无高度，映射表按占位高度收集）：
    load 不冒泡，捕获委托重收集锚点，并按源码侧最近目标行把预览重新对齐，
    否则图片多的文档在加载窗口期滚动后，两侧会停留在错位状态。
    多张图接连加载合并到每帧一次重收集+重对齐：逐张处理既造成布局抖动，
    又在连续联动滚动时与滚动流互相踩（来回拽 = 闪动） */
let imgAlignScheduled = false
function onImgLoad(e: Event): void {
  const img = e.target as HTMLImageElement | null
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    rememberImgSize(img.src, img.naturalWidth, img.naturalHeight)
  }
  if (imgAlignScheduled) return
  imgAlignScheduled = true
  requestAnimationFrame(() => {
    imgAlignScheduled = false
    if (!body.value) return
    collectBlocks()
    // 有待恢复进度（切签/模式进入未收敛）优先按进度钉住；否则按双栏联动锚行
    if (pendingFrac !== null) applyPendingScroll()
    else if (lastSyncLine !== null) syncToLine(lastSyncLine, 0)
  })
}

onMounted(() => {
  pullFind(docs.activeId, true) // 恢复当前标签共享的查找条状态
  // 主题令牌落定 → 图表按新配色重绘（换主题但明暗不变时 effectiveTheme 不触发）
  window.addEventListener('inkbox:theme-applied', onThemeApplied)
  // 即显侧拖列宽（广播）→ 本侧重放；预览面板保持挂载时切模式也要重放
  offTableWidths = onColWidthsChanged(() => {
    if (body.value) applyStoredTableWidths(body.value)
  })
  scroller.value?.addEventListener('mousemove', onPreviewMouseMoveTableCursor, { passive: true })
  scroller.value?.addEventListener('scroll', onScrollDom, { passive: true })
  scroller.value?.addEventListener('click', onClickDom)
  scroller.value?.addEventListener('load', onImgLoad, { capture: true, passive: true })
  // 字体加载/窗口缩放/图表渲染后块位置会变，重收集保持映射准确
  resizeObserver = new ResizeObserver(() => collectBlocks())
  if (scroller.value) resizeObserver.observe(scroller.value)
  if (body.value) resizeObserver.observe(body.value)
})

onBeforeUnmount(() => {
  offTableWidths?.()
  window.removeEventListener('inkbox:theme-applied', onThemeApplied)
  scroller.value?.removeEventListener('mousemove', onPreviewMouseMoveTableCursor)
  pushFind() // 兜底推送（正常情况下每次变化都已实时推送）
  scroller.value?.removeEventListener('scroll', onScrollDom)
  scroller.value?.removeEventListener('click', onClickDom)
  scroller.value?.removeEventListener('load', onImgLoad, { capture: true })
  resizeObserver?.disconnect()
  disconnectMermaidObserver()
  window.clearTimeout(renderTimer)
  window.clearTimeout(collectTimer)
})
</script>

<template>
  <div class="preview-wrap">
    <!-- 查找条：停靠在预览顶部，只搜索定位（无替换区）。
         双栏模式下不显示（源码侧已有同文档的查找条，两个口径的计数并排会互相打架），
         但仍按共享查询在渲染结果里高亮命中 -->
    <FindBar
      v-if="findOpen && ui.editorMode === 'preview'"
      ref="findBarRef"
      search-only
      :query="findQuery"
      :count="findCount"
      :active="findActive"
      :error="findError"
      @update:query="findQuery = $event"
      @nav="pvNav"
      @close="pvClose"
    />
    <div ref="scroller" class="preview-scroll" @mousedown.capture="onPreviewMouseDownTableWidths">
      <div v-if="html" ref="body" class="md-preview" />
      <div v-else class="preview-empty">{{ $t('preview.empty') }}</div>
    </div>
  </div>
</template>

<style scoped>
.preview-wrap {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.preview-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative; /* 作为 offsetTop 参照 */
  /* 关掉浏览器滚动锚定：视口上方图片加载时 Chromium 会自行挪 scrollTop，
     与本组件「按内容锚显式对齐」的模型互相打架（一帧两次落位 = 闪动），
     统一只由 syncToLine/onImgLoad 决定落点 */
  overflow-anchor: none;
}

.preview-empty {
  padding: 32px 20px;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: center;
}
</style>

<style>
/* 查找命中高亮：打在 v-html 内容上，作用域样式够不到；限定在预览容器内避免泄漏 */
.md-preview .pv-find-hit {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 2px;
}

.md-preview .pv-find-hit-active {
  background: color-mix(in srgb, var(--accent) 62%, transparent);
  box-shadow: 0 0 0 1px var(--accent-strong);
}
</style>
