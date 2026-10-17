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

/* ---------- 模块单例 / 缓存 / 串行锁 ---------- */

let mermaidMod: MermaidInstance | null = null
let mermaidLoading: Promise<MermaidInstance> | null = null
const mermaidCache = new Map<string, string>()
/** 渲染串行链：任何 m.run 都要挂到链尾（预览队列与即显 nodeView 共用） */
let mermaidChain: Promise<unknown> = Promise.resolve()

function themeVars(dark: boolean): Record<string, string> {
  return dark ? MERMAID_DARK : MERMAID_LIGHT
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
 *  组件 HMR 重挂载不触发主题 watch，渲染轮次前显式调用防旧配置渲染） */
export function configMermaidFor(dark: boolean): void {
  if (mermaidMod) configMermaid(mermaidMod, dark)
}

/** 主题切换：清缓存 + 重配置（两侧渲染方各自随后重画自己的图） */
export function rethemeMermaid(dark: boolean): void {
  mermaidCache.clear()
  if (mermaidMod) configMermaid(mermaidMod, dark)
}

/** 缓存 key（主题版本 | 亮暗 | 源码） */
export function mermaidCacheKey(code: string, dark: boolean): string {
  return `${MERMAID_THEME_VERSION}|${dark ? 'dark' : 'light'}|${code}`
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
