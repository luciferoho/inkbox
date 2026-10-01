<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ensureMath, renderWithDir } from '@/services/markdown'
import { useUiStore } from '@/stores/ui'
import { buildRegex, type FindQuery } from '@/find-shared'
import FindBar from './FindBar.vue'
import '@/assets/preview.css'

const props = defineProps<{ content: string; docDir: string | null }>()
const emit = defineEmits<{ (e: 'scroll-sync', line: number, frac: number): void }>()

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

watch(
  () => props.content,
  (content) => {
    window.clearTimeout(renderTimer)
    // 大文档全文重渲染一次要几百毫秒，防抖拉长避免连续输入时卡顿
    const delay = content.length > 200_000 ? 450 : 120
    renderTimer = window.setTimeout(() => void render(content), delay)
  },
  { immediate: true }
)

/** 换文档（docDir 变化）时立即重渲染并回到顶部：图片相对路径才能正确解析，
 *  滚动位置也不能沿用上一篇文档的（源码面板切标签会归零，两边口径一致） */
watch(
  () => props.docDir,
  () => {
    if (scroller.value) scroller.value.scrollTop = 0
    void render(props.content)
  }
)

/** 主题切换 → 只重渲染 mermaid 图表：其余内容的颜色全走 CSS 变量，
 *  [data-theme] 切换即自动跟随，无需重建 DOM。图表颜色是渲染时内联的，
 *  在离屏节点按新主题画好再原地替换——无占位塌陷、无闪烁、滚动不丢。
 *  （不能用清空 html 重建的路子：整页闪一下 + 滚动位置丢失；
 *  也不能移除 data-processed 原地重跑：run 会把 SVG 内部文本当源码） */
watch(
  () => ui.effectiveTheme,
  () => {
    mermaidCache.clear()
    if (mermaidMod) initMermaidTheme(mermaidMod)
    void rethemeMermaid()
  }
)

let rethemeSeq = 0

/** 主题切换：视口内的图离屏按新主题重绘后原地替换（无闪烁）；
 *  视口外的回到占位态入后台队列慢慢补——mermaid 的 run 是全局配置串行的，
 *  两百张图全量重绘要一分多钟，首屏可见的先换色才是用户关心的 */
async function rethemeMermaid(): Promise<void> {
  const nodes = [...(body.value?.querySelectorAll<HTMLElement>('.mermaid') ?? [])]
  if (nodes.length === 0) return
  const seq = ++rethemeSeq
  let m: MermaidInstance
  try {
    m = await loadMermaid()
    initMermaidTheme(m)
  } catch (err) {
    console.error('[preview] mermaid load failed:', err)
    return
  }
  const host = body.value
  const view = scroller.value?.getBoundingClientRect()
  const offs: { node: HTMLElement; off: HTMLElement; key: string }[] = []
  const later: HTMLElement[] = []
  for (const node of nodes) {
    if (seq !== rethemeSeq) return // 主题连切：本轮作废
    const code = node.dataset.mermaidSrc ?? ''
    if (!code || !node.isConnected) continue // 无源码（未渲染占位）交给常规 render 流程
    const key = `${MERMAID_THEME_VERSION}|${ui.effectiveTheme}|${code}`
    const hit = mermaidCache.get(key)
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
    try {
      await m.run({ nodes: offs.map((o) => o.off), suppressErrors: true })
    } catch (err) {
      console.error('[preview] mermaid retheme failed:', err)
    }
    for (const { node, off, key } of offs) {
      // 渲染失败的节点无 svg：保持原样（占位交给常规流程），不标 processed
      if (off.querySelector('svg') && off.isConnected) {
        node.innerHTML = off.innerHTML
        node.setAttribute('data-processed', 'true')
        mermaidCache.set(key, off.innerHTML)
      }
      off.remove()
    }
  }
  if (seq !== rethemeSeq) return
  for (const node of later) {
    node.removeAttribute('data-processed')
    node.textContent = node.dataset.mermaidSrc ?? ''
    mermaidQueue.push(node)
  }
  if (later.length > 0) void pumpMermaidQueue(m)
  collectBlocks()
}

async function render(content: string): Promise<void> {
  const seq = ++renderSeq
  await ensureMath(content)
  if (seq !== renderSeq) return
  html.value = content.trim() ? renderWithDir(content, props.docDir) : ''
  await nextTick()
  // 关闸：等待期间若又开始了新渲染，本轮作废——否则陈旧回合会在
  // 新一轮已渲染完的 DOM 上重跑 mermaid（把 SVG 内的 <style> 文本当源码）
  if (seq !== renderSeq) return
  collectBlocks()
  await renderMermaid()
  if (findOpen.value) pvSearch() // 内容重渲染重置了 DOM，开着查找就重扫
}

/* ---------- mermaid 异步渲染（带缓存） ---------- */

import type { Mermaid as MermaidInstance } from 'mermaid'
let mermaidMod: MermaidInstance | null = null
let mermaidLoading: Promise<MermaidInstance> | null = null
const mermaidCache = new Map<string, string>()

/**
 * 按当前生效主题配置 mermaid（加载时与主题切换后各调一次）。
 * 用 base 主题 + 全量 themeVariables：墨匣纸面琥珀系配色，文字对比度
 * 显式拉满（默认主题的序列图消息文字/饼图图例在浅色底上看不清，导出同病）。
 * 字体用具体字栈（SVG 内联样式，CSS 变量在导出 HTML 里不可依赖）。
 */
const MERMAID_FONT = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"

/** 主题配置版本：进 mermaid 渲染缓存 key——改配色后旧缓存自动失效（缓存 key 只含
 *  theme|code，改 themeVariables 不换版本的话用户看到的永远是旧渲染） */
const MERMAID_THEME_VERSION = '2'

const MERMAID_LIGHT = {
  background: 'transparent',
  fontFamily: MERMAID_FONT,
  fontSize: '14px',
  // 通用（flowchart/类图等）。edgeLabelBackground 用实际背景色值而非 'transparent'：
  // mermaid 的 fade() 会把 'transparent' 按黑色混出 rgba(0,0,0,.5) 的暗底
  primaryColor: '#f3e5cf',
  primaryTextColor: '#2b2420',
  primaryBorderColor: '#c9701f',
  lineColor: '#9c8f7f',
  textColor: '#2b2420',
  edgeLabelBackground: '#f6f2ec',
  // 序列图
  actorBkg: '#f3e5cf',
  actorTextColor: '#2b2420',
  actorBorder: '#c9701f',
  actorLineColor: '#d8cfc0',
  signalColor: '#6b5f52',
  signalTextColor: '#4a4036',
  labelBoxBkgColor: '#f3e5cf',
  labelBoxBorderColor: '#c9701f',
  labelTextColor: '#4a4036',
  loopTextColor: '#4a4036',
  noteBkgColor: '#fdf3e0',
  noteTextColor: '#4a4036',
  noteBorderColor: '#e0c9a0',
  activationBkgColor: '#f3e5cf',
  // 饼图（ECharts 质感：不透明扇区 + 纸面描边间隔 + 深色图例/标题）
  pieTitleTextColor: '#2b2420',
  pieTitleTextSize: '19px',
  pieSectionTextColor: '#ffffff',
  pieSectionTextSize: '13px',
  pieLegendTextColor: '#4a4036',
  pieLegendTextSize: '13px',
  pieStrokeColor: '#f6f2ec',
  pieStrokeWidth: '2px',
  pieOpacity: '1',
  pie1: '#c9701f',
  pie2: '#2e7f72',
  pie3: '#a85a32',
  pie4: '#7c7267',
  pie5: '#e0a458',
  pie6: '#5bb8a8',
  pie7: '#8a5a3a',
  pie8: '#b0a494',
  pie9: '#d98e4a',
  pie10: '#3a9c8c',
  pie11: '#c2503e',
  pie12: '#9c8f7f'
}

const MERMAID_DARK = {
  background: 'transparent',
  fontFamily: MERMAID_FONT,
  fontSize: '14px',
  primaryColor: '#3b3128',
  primaryTextColor: '#eae2d6',
  primaryBorderColor: '#e6a054',
  lineColor: '#a89d8e',
  textColor: '#eae2d6',
  edgeLabelBackground: '#1d1814',
  actorBkg: '#3b3128',
  actorTextColor: '#eae2d6',
  actorBorder: '#e6a054',
  actorLineColor: '#4a4036',
  signalColor: '#c0b4a4',
  signalTextColor: '#eae2d6',
  labelBoxBkgColor: '#3b3128',
  labelBoxBorderColor: '#e6a054',
  labelTextColor: '#eae2d6',
  loopTextColor: '#eae2d6',
  noteBkgColor: '#332a21',
  noteTextColor: '#eae2d6',
  noteBorderColor: '#5b5044',
  activationBkgColor: '#3b3128',
  pieTitleTextColor: '#eae2d6',
  pieTitleTextSize: '19px',
  pieSectionTextColor: '#1d1814',
  pieSectionTextSize: '13px',
  pieLegendTextColor: '#eae2d6',
  pieLegendTextSize: '13px',
  pieStrokeColor: '#1d1814',
  pieStrokeWidth: '2px',
  pieOpacity: '1',
  pie1: '#e6a054',
  pie2: '#5bb8a8',
  pie3: '#d98e4a',
  pie4: '#a89d8e',
  pie5: '#f0b26e',
  pie6: '#7cc8b8',
  pie7: '#c09070',
  pie8: '#c0b4a4',
  pie9: '#e6b880',
  pie10: '#8ad0c0',
  pie11: '#d66a55',
  pie12: '#8a7d6d'
}

function initMermaidTheme(inst: MermaidInstance): void {
  const dark = ui.effectiveTheme === 'dark'
  inst.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: dark ? MERMAID_DARK : MERMAID_LIGHT
  })
}

function loadMermaid(): Promise<MermaidInstance> {
  mermaidLoading ??= import('mermaid').then((m): MermaidInstance => {
    const inst = m.default
    initMermaidTheme(inst)
    mermaidMod = inst
    return inst
  })
  return mermaidLoading
}

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

/** 渲染单个占位节点：缓存命中同步替换，否则 mermaid 渲染 + 归档/降级 */
async function renderMermaidNode(m: MermaidInstance, node: HTMLElement): Promise<void> {
  if (!node.isConnected || node.getAttribute('data-processed') === 'true') return
  const code = node.textContent ?? ''
  const key = `${MERMAID_THEME_VERSION}|${ui.effectiveTheme}|${code}`
  const hit = mermaidCache.get(key)
  if (hit !== undefined) {
    node.innerHTML = hit
    node.setAttribute('data-processed', 'true')
    // 源码存档：主题切换的离屏重渲染（rethemeMermaid）凭它还原占位输入
    node.setAttribute('data-mermaid-src', code)
    scheduleCollect()
    return
  }
  try {
    await m.run({ nodes: [node], suppressErrors: true })
  } catch {
    /* 失败节点在下方统一降级 */
  }
  if (!node.isConnected) return
  if (node.querySelector('svg')) {
    node.setAttribute('data-processed', 'true')
    node.setAttribute('data-mermaid-src', code)
    mermaidCache.set(key, node.innerHTML)
  } else {
    // 渲染失败的节点：mermaid 已写回错误文本，还原源码展示
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
  let m: MermaidInstance
  try {
    m = await loadMermaid()
    initMermaidTheme(m)
  } catch (err) {
    console.error('[preview] mermaid load failed:', err)
    return
  }
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
  blocks = [...body.value.querySelectorAll<HTMLElement>('[data-source-line]')].map((el) => ({
    line: Number(el.dataset.sourceLine) + 1,
    end: Math.max(Number(el.dataset.sourceLine) + 1, Number(el.dataset.sourceLineEnd)),
    top: el.offsetTop,
    height: el.offsetHeight
  }))
  // 脚注区补锚：markdown-it-footnote 的 section 没有 data-source-line
  // （脚注定义在源码文末），不补的话源码滚到脚注定义区时预览停在最后
  // 一个正文块，两边失同步。锚到文档总行数：源码滚到底 ↔ 预览滚到脚注区
  const foot = body.value.querySelector<HTMLElement>('.footnotes')
  if (foot) {
    const totalLines = props.content ? props.content.split('\n').length : 1
    blocks.push({ line: totalLines, end: totalLines, top: foot.offsetTop, height: foot.offsetHeight })
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

/* 预览滚动 → 通知编辑器：块内按行跨度插值出行号 */
function onScrollDom(): void {
  if (Date.now() < lockUntil) return
  const el = scroller.value
  if (!el || blocks.length === 0) return
  const { i, f } = blockAtScrollTop(el.scrollTop)
  const cur = blocks[i]
  const next = blocks[i + 1]
  const lineSpan = next ? next.line - cur.line : Math.max(1, cur.end - cur.line)
  emit('scroll-sync', cur.line + f * lineSpan, 0)
}

/* 编辑器滚动 → 同步预览：目标行落在哪个块内，块内按高度比例插值 */
function syncToLine(line: number, _frac: number): void {
  const el = scroller.value
  if (!el || blocks.length === 0) return
  let i = 0
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].line <= line) i = k
    else break
  }
  const cur = blocks[i]
  const next = blocks[i + 1]
  const lineSpan = next ? next.line - cur.line : Math.max(1, cur.end - cur.line)
  const f = Math.min(1, Math.max(0, (line - cur.line) / lineSpan))
  const topSpan = next ? next.top - cur.top : Math.max(1, cur.height)
  lockUntil = Date.now() + 120
  el.scrollTop = Math.max(0, cur.top + f * topSpan - 6)
}

defineExpose({ syncToLine })

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

function pvClearHighlights(): void {
  const root = body.value
  if (!root) return
  root.querySelectorAll('.pv-find-hit').forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent ?? ''))
  })
  root.normalize() // 合并被拆开的相邻文本节点，避免下轮匹配错位
  findHits = []
}

/** 全文收集文本节点（跳过图表/公式），命中包一层高亮 span */
function pvSearch(): void {
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
  if (hits.length) pvShowHit(0)
}

function pvShowHit(i: number): void {
  findHits.forEach((el, k) => el.classList.toggle('pv-find-hit-active', k === i))
  // scrollIntoView 不依赖焦点，预览面板无焦点也能定位
  findHits[i]?.scrollIntoView({ block: 'center' })
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
  if (findOpen.value) pvSearch()
})

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

/* ---------- 图片点击 → 查看器 ---------- */

function onClickDom(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG' && target.parentElement?.closest('.md-preview')) {
    e.preventDefault()
    ui.viewerImage = (target as HTMLImageElement).src
  }
}

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  scroller.value?.addEventListener('scroll', onScrollDom, { passive: true })
  scroller.value?.addEventListener('click', onClickDom)
  // 字体加载/窗口缩放/图表渲染后块位置会变，重收集保持映射准确
  resizeObserver = new ResizeObserver(() => collectBlocks())
  if (scroller.value) resizeObserver.observe(scroller.value)
  if (body.value) resizeObserver.observe(body.value)
})

onBeforeUnmount(() => {
  scroller.value?.removeEventListener('scroll', onScrollDom)
  scroller.value?.removeEventListener('click', onClickDom)
  resizeObserver?.disconnect()
  disconnectMermaidObserver()
  window.clearTimeout(renderTimer)
  window.clearTimeout(collectTimer)
})
</script>

<template>
  <div class="preview-wrap">
    <!-- 查找条：停靠在预览顶部，只搜索定位（无替换区） -->
    <FindBar
      v-if="findOpen"
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
    <div ref="scroller" class="preview-scroll">
      <div v-if="html" ref="body" class="md-preview" v-html="html" />
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
