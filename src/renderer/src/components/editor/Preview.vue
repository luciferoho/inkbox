<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ensureMath, renderWithDir } from '@/services/markdown'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { buildRegex, type FindQuery } from '@/find-shared'
import { findState, sameQuery } from '@/editor/find-state'
import { saveViewProgress, loadView } from '@/editor/tab-view-state'
import { applyCachedImageSizes, rememberImgSize } from '@/editor/img-size-cache'
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
  applyBlankGaps() // 空行占位先插入，块映射与切签锚点才拿得到最终布局
  if (body.value) applyCachedImageSizes(body.value) // 图片占位尺寸先落位，块映射与切签锚点才不会按塌缩布局算
  collectBlocks()
  applyPvFocus() // DOM 重建后重放双栏联动高亮（光标没动就不需要等下一次 emit）
  renderQueued = false
  applyPendingScroll() // 切签滚动恢复：内容 DOM 换完即落位（mermaid 异步只改局部高度）
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

/* ---------- 图片点击 → 查看器 ---------- */

function onClickDom(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG' && target.parentElement?.closest('.md-preview')) {
    e.preventDefault()
    ui.viewerImage = (target as HTMLImageElement).src
  }
}

let resizeObserver: ResizeObserver | undefined

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
  scroller.value?.addEventListener('scroll', onScrollDom, { passive: true })
  scroller.value?.addEventListener('click', onClickDom)
  scroller.value?.addEventListener('load', onImgLoad, { capture: true, passive: true })
  // 字体加载/窗口缩放/图表渲染后块位置会变，重收集保持映射准确
  resizeObserver = new ResizeObserver(() => collectBlocks())
  if (scroller.value) resizeObserver.observe(scroller.value)
  if (body.value) resizeObserver.observe(body.value)
})

onBeforeUnmount(() => {
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
