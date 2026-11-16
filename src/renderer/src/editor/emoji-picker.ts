/**
 * 表情选择器（插入面板/右键「插入→表情」入口的数据层）：
 * - 打开时锚在光标处（PM/源码双端），检测「替换上下文」——光标紧邻（前后）
 *   或选区恰好覆盖一个 emoji 时，选中即替换而不是追加（编辑已有表情）
 * - 最近使用存 localStorage（跨会话，无需动 config schema）
 * - 词表与输入补全同源（cm-emoji-completion 的 EMOJI_DEFS，gemoji 短代码）
 */
import { reactive } from 'vue'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView as PmView } from '@milkdown/kit/prose/view'
import type { EditorView as CmView } from '@codemirror/view'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { EMOJI_DEFS } from './cm-emoji-completion'

export const emojiPicker = reactive({
  open: false,
  x: 0,
  y: 0,
  search: '',
  target: 'pm' as 'pm' | 'cm'
})

let livePm: PmView | null = null
let liveCm: CmView | null = null

/* ---------- 最近使用（localStorage，跨会话） ---------- */

const RECENTS_KEY = 'inkbox-emoji-recents'
const RECENTS_MAX = 24

export function getRecentEmojis(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((c) => typeof c === 'string') : []
  } catch {
    return []
  }
}

function pushRecentEmoji(ch: string): void {
  const list = [ch, ...getRecentEmojis().filter((c) => c !== ch)].slice(0, RECENTS_MAX)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list))
  } catch {
    /* 存储受限：最近使用只是辅助，静默放弃 */
  }
}

/* ---------- 同类联想（手动输入 emoji 字符时弹出，按短代码前缀归类） ---------- */

/** 字符 → 主短代码（最短 名字，悬浮提示用）。惰性建表：初始化期读词表
 *  会被别的模块加载顺序影响（TDZ），首次用到再算 */
export function emojiNameByChar(): Map<string, string> {
  if (!nameByCharCache) {
    nameByCharCache = new Map()
    for (const [name, ch] of Object.entries(EMOJI_DEFS)) {
      const c = String(ch)
      const cur = nameByCharCache.get(c)
      if (cur === undefined || name.length < cur.length) nameByCharCache.set(c, name)
    }
  }
  return nameByCharCache
}
let nameByCharCache: Map<string, string> | null = null

/* ---------- 字形测量（选择器网格 / 即显弹层共用的缩放依据） ---------- */

/** 20px 基准字号下的字形 advance（canvas 惰性测量 + 缓存）。
 *  canvas 与 DOM 走同一套字体整形，组合表情的实测宽和实际渲染一致 */
const MEASURE_FONT = '20px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
let measureCtx: CanvasRenderingContext2D | null = null
const advanceCache = new Map<string, number>()

export function advance20(ch: string): number {
  const cached = advanceCache.get(ch)
  if (cached !== undefined) return cached
  try {
    measureCtx ??= (() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) ctx.font = MEASURE_FONT
      return ctx
    })()
    if (!measureCtx) return ch.length * 10
    const w = measureCtx.measureText(ch).width
    advanceCache.set(ch, w)
    return w
  } catch {
    return ch.length * 10
  }
}

/** 把字形缩进 slotPx 宽度内的实际字号（只缩不放，下限 6px）。
 *  统一格子后宽 ZWJ 组合不再占多列（多列让行节奏参差、顺序跳动，用户实测截图），
 *  而是缩小留在自己的格子里 */
export function fitFontSize(ch: string, slotPx: number, fontPx: number): number {
  const w = (advance20(ch) * fontPx) / 20
  if (w <= slotPx) return fontPx
  return Math.max(6, (fontPx * slotPx) / w)
}

/* ---------- 打开/关闭 ---------- */

function liveView(target: 'pm' | 'cm'): PmView | CmView | null {
  if (target === 'pm') {
    return pmViews().find((v) => v && v.dom && v.dom.isConnected) ?? null
  }
  return cmViews().find((v) => v && v.dom && v.dom.isConnected) ?? null
}

export function openEmojiPicker(target: 'pm' | 'cm'): boolean {
  const v = liveView(target)
  if (!v) return false
  livePm = null
  liveCm = null
  let cx = 0
  let cy = 0
  if (target === 'pm') {
    const pm = v as PmView
    livePm = pm
    const sel = pm.state.selection
    const head = (sel as TextSelection).head ?? sel.from
    try {
      const c = pm.coordsAtPos(head)
      if (!c) return false
      cx = c.left
      cy = c.bottom
    } catch {
      return false
    }
    } else {
    const cm = v as CmView
    liveCm = cm
    const sel = cm.state.selection.main
    try {
      const c = cm.coordsAtPos(sel.head)
      if (!c) return false
      cx = c.left
      cy = c.bottom
    } catch {
      return false
    }
  }
  emojiPicker.target = target
  emojiPicker.search = ''
  emojiPicker.x = cx
  emojiPicker.y = cy
  emojiPicker.open = true
  return true
}

export function closeEmojiPicker(): void {
  emojiPicker.open = false
  emojiPicker.search = ''
  livePm = null
  liveCm = null
}

/* ---------- 插入 ---------- */

export function insertEmojiPick(ch: string): boolean {
  if (livePm) {
    const sel = livePm.state.selection
    if (!(sel instanceof TextSelection)) return false
    livePm.dispatch(livePm.state.tr.insertText(ch, sel.from, sel.to).scrollIntoView())
    livePm.focus()
  } else if (liveCm) {
    const sel = liveCm.state.selection.main
    liveCm.dispatch({
      changes: { from: sel.from, to: sel.to, insert: ch },
      selection: { anchor: sel.from + ch.length }
    })
    liveCm.focus()
  } else {
    return false
  }
  pushRecentEmoji(ch)
  closeEmojiPicker()
  return true
}
