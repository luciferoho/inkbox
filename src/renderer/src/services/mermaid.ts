import type { Mermaid as MermaidInstance } from 'mermaid'

export type { MermaidInstance }

/**
 * mermaid 渲染共享服务：预览管线（Preview.vue 视口懒渲染队列）与
 * 即显模式（wysiwyg-mermaid.ts 的 code_block nodeView）共用同一份
 * 主题配置、模块单例、渲染缓存与全局串行锁。
 * mermaid 的 run 共享全局配置且不可并发（并发 run 互相踩），
 * 两侧的渲染都必须经 withMermaidLock 排队。
 */

/* ---------- 主题配置（墨匣纸面琥珀系，与 preview 原实现一致） ---------- */

const MERMAID_FONT = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"

/** 主题配置版本：进渲染缓存 key——改配色后旧缓存自动失效 */
const MERMAID_THEME_VERSION = '4'

const MERMAID_LIGHT = {
  background: 'transparent',
  fontFamily: MERMAID_FONT,
  fontSize: '14px',
  // 通用（flowchart/类图等）。edgeLabelBackground 用实际背景色值而非 'transparent'：
  // mermaid 的 fade() 会把 'transparent' 按黑色混出 rgba(0,0,0,.5) 的暗底
  primaryColor: '#efece5',
  primaryTextColor: '#37352f',
  primaryBorderColor: '#c9701f',
  lineColor: '#a09a90',
  textColor: '#37352f',
  edgeLabelBackground: '#faf9f7',
  // 序列图
  actorBkg: '#efece5',
  actorTextColor: '#37352f',
  actorBorder: '#c9701f',
  actorLineColor: '#d4d0c8',
  signalColor: '#6f6a61',
  signalTextColor: '#46433d',
  labelBoxBkgColor: '#efece5',
  labelBoxBorderColor: '#c9701f',
  labelTextColor: '#46433d',
  loopTextColor: '#46433d',
  noteBkgColor: '#faf0dd',
  noteTextColor: '#46433d',
  noteBorderColor: '#e2cda2',
  activationBkgColor: '#efece5',
  // 饼图（ECharts 质感：不透明扇区 + 纸面描边间隔 + 深色图例/标题）
  pieTitleTextColor: '#37352f',
  pieTitleTextSize: '19px',
  pieSectionTextColor: '#ffffff',
  pieSectionTextSize: '13px',
  pieLegendTextColor: '#46433d',
  pieLegendTextSize: '13px',
  pieStrokeColor: '#faf9f7',
  pieStrokeWidth: '2px',
  pieOpacity: '1',
  pie1: '#c9701f',
  pie2: '#2e7f72',
  pie3: '#a85a32',
  pie4: '#86817a',
  pie5: '#e0a458',
  pie6: '#5bb8a8',
  pie7: '#8a5a3a',
  pie8: '#b3ada2',
  pie9: '#d98e4a',
  pie10: '#3a9c8c',
  pie11: '#c2503e',
  pie12: '#a09a90'
}

const MERMAID_DARK = {
  background: 'transparent',
  fontFamily: MERMAID_FONT,
  fontSize: '14px',
  // 节点底色不能与页面底同深（值过接近时序列图的双层文本会糊成一团）：
  // 页面 #171a21，节点用更亮的蓝灰，形成清晰层次
  primaryColor: '#3a4050',
  primaryTextColor: '#d2d8e2',
  primaryBorderColor: '#e3a45c',
  lineColor: '#8d95a5',
  textColor: '#d2d8e2',
  edgeLabelBackground: '#171a21',
  // 序列图专用（mermaid 不读上面的 textColor）：参与者/信号/标签一律浅色，
  // 底色与节点同档——深底配浅字对比不足时标签框里会显脏
  actorBkg: '#3a4050',
  actorTextColor: '#d2d8e2',
  actorBorder: '#e3a45c',
  actorLineColor: '#565d6d',
  signalColor: '#c3cad6',
  signalTextColor: '#d2d8e2',
  labelBoxBkgColor: '#3a4050',
  labelBoxBorderColor: '#e3a45c',
  labelTextColor: '#d2d8e2',
  loopTextColor: '#d2d8e2',
  noteBkgColor: '#313643',
  noteTextColor: '#d2d8e2',
  noteBorderColor: '#6d7688',
  activationBkgColor: '#3a4050',
  activationBorderColor: '#e3a45c',
  sequenceNumberColor: '#171a21',
  // 类图 / 状态图标签
  labelColor: '#d2d8e2',
  pieTitleTextColor: '#d2d8e2',
  pieTitleTextSize: '19px',
  pieSectionTextColor: '#171a21',
  pieSectionTextSize: '13px',
  pieLegendTextColor: '#d2d8e2',
  pieLegendTextSize: '13px',
  pieStrokeColor: '#171a21',
  pieStrokeWidth: '2px',
  pieOpacity: '1',
  pie1: '#e3a45c',
  pie2: '#63b8a6',
  pie3: '#d98e4a',
  pie4: '#8d95a5',
  pie5: '#edb877',
  pie6: '#7cc8b8',
  pie7: '#c09070',
  pie8: '#b0b8c4',
  pie9: '#e6b880',
  pie10: '#8ad0c0',
  pie11: '#d97764',
  pie12: '#7d8595'
}

/* ---------- 模块单例 / 缓存 / 串行锁 ---------- */

let mermaidMod: MermaidInstance | null = null
let mermaidLoading: Promise<MermaidInstance> | null = null
const mermaidCache = new Map<string, string>()
/** 渲染串行链：任何 m.run 都要挂到链尾（预览队列与即显 nodeView 共用） */
let mermaidChain: Promise<unknown> = Promise.resolve()

/** 浏览器解析出的颜色 → 标准 rgb()/rgba()。
 *  Chromium 对 color-mix() 的结果返回 `color(srgb 0.18 0.2 0.25 / 1)` 形式，
 *  mermaid 的颜色解析器只认 rgb()/rgba()/hex，直接传会整图渲染失败；
 *  oklch()/lab() 等无法安全转换的形式返回 null（调用方保留内置色）。 */
function toCssRgb(c: string): string | null {
  const s = c.trim()
  const srgb = s.match(
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i
  )
  if (srgb) {
    const rgb = [srgb[1], srgb[2], srgb[3]].map((n) => Math.round(Number(n) * 255))
    const a = srgb[4] === undefined ? 1 : Number(srgb[4])
    return a >= 1
      ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
      : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Number(a.toFixed(3))})`
  }
  if (/^rgba?\(/i.test(s)) return s
  const hex = s.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) return s
  return null
}

/** 令牌颜色解析：getComputedStyle 读自定义属性返回的是原文（未解析的
 *  color-mix()/var()），直接交给 mermaid 会解析失败退化成源码展示。
 *  经 CSS.supports 校验 + 探针元素交给浏览器解析，再归一成 rgb()；
 *  解析不了返回 null（调用方保留内置调色板，宁可主色差一点也不能让图表渲染失败）。 */
let probeEl: HTMLElement | null = null
function resolveTokenColor(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  try {
    if (!CSS.supports('color', v)) return null
    if (!probeEl) {
      probeEl = document.createElement('span')
      probeEl.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0'
      document.body.appendChild(probeEl)
    }
    probeEl.style.color = v
    return toCssRgb(getComputedStyle(probeEl).color)
  } catch {
    return null
  }
}

function themeVars(dark: boolean): Record<string, string> {
  const base: Record<string, string> = { ...(dark ? MERMAID_DARK : MERMAID_LIGHT) }
  // 跟随主题：图表的节点底/文字/描边取应用令牌（主题模式下这些令牌由主题
  // 变量桥写成主题色），图表与所选主题色调一致，而不是永远内置琥珀系。
  // 令牌缺失/无法解析（内置主题、导出环境）时保留内置调色板
  const read = (name: string): string | null => {
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
      return resolveTokenColor(raw)
    } catch {
      return null
    }
  }
  try {
    const bg = read('--bg')
    const text = read('--text')
    const accent = read('--accent')
    const surface2 = read('--surface-2')
    const text2 = read('--text-2')
    if (bg) base.edgeLabelBackground = bg
    if (text) {
      base.textColor = text
      base.primaryTextColor = text
      base.actorTextColor = text
      base.signalTextColor = text
      base.labelTextColor = text
      base.loopTextColor = text
      base.noteTextColor = text
      base.labelColor = text
      base.pieTitleTextColor = text
      base.pieLegendTextColor = text
    }
    if (surface2) {
      base.primaryColor = surface2
      base.actorBkg = surface2
      base.labelBoxBkgColor = surface2
      base.noteBkgColor = surface2
      base.activationBkgColor = surface2
    }
    if (accent) {
      base.primaryBorderColor = accent
      base.actorBorder = accent
      base.labelBoxBorderColor = accent
      base.activationBorderColor = accent
    }
    if (text2) {
      base.lineColor = text2
      base.signalColor = text2
      base.actorLineColor = text2
      base.noteBorderColor = text2
    }
  } catch {
    /* 任何解析异常都退回内置调色板：图表可用性优先 */
  }
  return base
}

/** 主题令牌签名：进缓存 key——换主题（即使明暗不变）时旧图配色也要失效 */
function tokenSignature(): string {
  try {
    const cs = getComputedStyle(document.documentElement)
    return ['--bg', '--text', '--accent', '--surface-2', '--text-2']
      .map((n) => cs.getPropertyValue(n).trim())
      .join('|')
  } catch {
    return ''
  }
}

function configMermaid(inst: MermaidInstance, dark: boolean): void {
  inst.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVars(dark)
  })
}

/** 懒加载 + 按当前主题配置（幂等） */
export function loadMermaid(dark: boolean): Promise<MermaidInstance | null> {
  mermaidLoading ??= import('mermaid')
    .then((m): MermaidInstance => {
      const inst = m.default
      configMermaid(inst, dark)
      mermaidMod = inst
      return inst
    })
    .catch(() => null as unknown as MermaidInstance)
  return mermaidLoading
}

/** 已加载的前提下重应用当前主题配置（initialize 只是设配置对象，开销可忽略；
 *  组件 HMR 重挂载不触发主题 watch，渲染轮次前显式调用防旧配置渲染）。
 *  经串行链排队：并发 initialize 会清掉 flowchart-v2 布局中间态（实测把
 *  排队中的流程图渲染成 0×0 空图），绝不能与 run 交错 */
export function configMermaidFor(dark: boolean): void {
  if (!mermaidMod) return
  const inst = mermaidMod
  mermaidChain = mermaidChain.then(
    () => configMermaid(inst, dark),
    () => configMermaid(inst, dark)
  )
}

/** 串行锁内同步应用当前主题配置：run 读取的是「执行时刻」的全局配置，
 *  排队前的 configMermaidFor 可能已过期（主题在队列消化期间翻转）——
 *  渲染闭包里调用本函数保证每张图按当下极性出图 */
export function applyMermaidConfigInLock(dark: boolean): void {
  if (mermaidMod) configMermaid(mermaidMod, dark)
}

/** 主题切换：清缓存 + 重配置（两侧渲染方各自随后重画自己的图）。
 *  initialize 排串行链（理由同 configMermaidFor） */
export function rethemeMermaid(dark: boolean): void {
  mermaidCache.clear()
  if (!mermaidMod) return
  const inst = mermaidMod
  mermaidChain = mermaidChain.then(
    () => configMermaid(inst, dark),
    () => configMermaid(inst, dark)
  )
}

/** 缓存 key（主题版本 | 亮暗 | 令牌签名 | 源码）：签名含主题色，
 *  换主题（即使明暗相同）时旧配色缓存自然失效 */
export function mermaidCacheKey(code: string, dark: boolean): string {
  return `${MERMAID_THEME_VERSION}|${dark ? 'dark' : 'light'}|${tokenSignature()}|${code}`
}

export function getMermaidCache(key: string): string | undefined {
  return mermaidCache.get(key)
}

export function setMermaidCache(key: string, html: string): void {
  mermaidCache.set(key, html)
}

/** 全局串行执行一次 mermaid 渲染（run 共享全局配置，不能并发） */
export function withMermaidLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = mermaidChain.then(fn, fn)
  mermaidChain = next.catch(() => undefined)
  return next
}

/** 渲染结果健康校验：无 svg、mermaid 错误图（aria-roledescription="error"）、
 *  退化空图（viewBox 内容尺寸≈0，实测 16×16 = 布局竞态下的空图）都算失败。
 *  失败结果绝不能进缓存/标 processed，否则坏图会被后续所有挂载回放 */
export function isHealthyMermaidSvg(svg: Element | null | undefined): boolean {
  if (!svg) return false
  if (svg.getAttribute('aria-roledescription') === 'error') return false
  const nums = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
    if (nums[2] <= 20 && nums[3] <= 20) return false
  }
  return true
}
