import { reactive } from 'vue'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView as PmView } from '@milkdown/kit/prose/view'
import type { EditorView as CmView } from '@codemirror/view'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { currentLocale } from '@/i18n'

/**
 * 日期选择器（插入面板 / 右键「插入→日期」入口的数据层，DatePicker.vue 渲染）：
 * - 打开不抢焦点，锚在光标处（即显/源码双端）；Esc / 点外 / 窗口失焦 / 继续输入收起
 * - 点日格、按 Enter、点「今天」都直接插入该日（YYYY-MM-DD，替换当前选区）
 * - 日期一律按本地时区算：toISOString 是 UTC，东八区早 8 点前会插成前一天
 */

type Target = 'pm' | 'cm'

/** 本地日期（m 为 0 基月份，与 Date 一致） */
export interface LocalDate {
  y: number
  m: number
  d: number
}

export const datePicker = reactive({
  open: false,
  /** 锚点：光标所在行的左缘与上下沿，DatePicker.vue 换算浮层位置
   *  （下方放得下就贴着下沿，放不下贴着上沿上翻——两头都要用，只记下沿会盖住光标行） */
  x: 0,
  top: 0,
  bottom: 0,
  target: 'pm' as Target,
  /** 视图年月（m 为 0 基）。与 cursor 分开存：悬停邻月补位日只移高亮、不翻页 */
  year: 0,
  month: 0,
  /** 高亮日（键盘移动 / 悬停），Enter 插入它 */
  cursor: { y: 0, m: 0, d: 1 } as LocalDate
})

let livePm: PmView | null = null
let liveCm: CmView | null = null

/* ---------- 日期算术（全部本地时区） ---------- */

export function toLocal(date: Date): LocalDate {
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() }
}

export function sameDay(a: LocalDate, b: LocalDate): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d
}

/** 插入文本：YYYY-MM-DD */
export function isoOf(day: LocalDate): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${day.y}-${pad(day.m + 1)}-${pad(day.d)}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

/** 周首日（0 = 周日 … 6 = 周六）：跟应用语言的历法习惯（中文周一、英文周日） */
export function weekStart(): number {
  try {
    // Intl.Locale#getWeekInfo（1 = 周一 … 7 = 周日）。Electron 44 的 Chromium 152 里只有这个方法、
    // 没有 weekInfo 取值器；TS lib 也没有它的类型，按结构取。取不到就按周一
    const { getWeekInfo } = new Intl.Locale(currentLocale()) as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number }
    }
    const fd = getWeekInfo?.().firstDay
    if (fd === 7) return 0
    return fd !== undefined && fd >= 1 && fd <= 6 ? fd : 1
  } catch {
    return 1
  }
}

export interface DayCell {
  day: LocalDate
  iso: string
  /** 是否属于视图月份（邻月补位日置灰） */
  inMonth: boolean
}

/** 视图月份的 6×7 日历格：从含 1 号那一周的周首日起算。恒 42 格，
 *  浮层高度不随月份跨 4/5/6 周而跳动 */
export function monthGrid(year: number, month: number, start: number): DayCell[] {
  const lead = (new Date(year, month, 1).getDay() - start + 7) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const day = toLocal(new Date(year, month, 1 - lead + i))
    return { day, iso: isoOf(day), inMonth: day.m === month }
  })
}

/* ---------- 打开 / 关闭 ---------- */

function liveView(target: Target): PmView | CmView | null {
  if (target === 'pm') {
    return pmViews().filter((v) => v.dom && v.dom.isConnected).pop() ?? null
  }
  return cmViews().filter((v) => v && v.dom && v.dom.isConnected).pop() ?? null
}

/** 打开选择器（锚在光标所在行，默认高亮今天）；目标编辑器不存在时不弹 */
export function openDatePicker(target: Target): boolean {
  const v = liveView(target)
  if (!v) return false
  // 光标所在行的屏幕矩形（上下沿都要：下方放得下贴下沿，否则贴上沿上翻）。
  // 实测即显里凡是光标到得了的位置 coordsAtPos 都给出正常行高（空段落/空列表项/空单元格/空代码块都是）
  let anchor: { left: number; top: number; bottom: number } | null = null
  try {
    if (target === 'pm') {
      const pm = v as PmView
      // 选中的是图片、表格单元格这类非文本位置时插不进去（insertDatePick 只认文本选区）：
      // 干脆不弹，免得点了日期没反应
      if (!(pm.state.selection instanceof TextSelection)) return false
      const c = pm.coordsAtPos(pm.state.selection.head)
      if (c) anchor = { left: c.left, top: c.top, bottom: c.bottom }
    } else {
      const c = v.coordsAtPos((v as CmView).state.selection.main.head)
      if (c) anchor = { left: c.left, top: c.top, bottom: c.bottom }
    }
  } catch {
    return false
  }
  if (!anchor) return false
  livePm = target === 'pm' ? (v as PmView) : null
  liveCm = target === 'cm' ? (v as CmView) : null
  datePicker.target = target
  datePicker.x = anchor.left
  datePicker.top = anchor.top
  datePicker.bottom = anchor.bottom
  setCursor(toLocal(new Date()))
  datePicker.open = true
  return true
}

export function closeDatePicker(): void {
  datePicker.open = false
  livePm = null
  liveCm = null
}

/** 按键目标是否还在打开选择器的那台编辑器里（焦点被别的弹层/侧栏抢走后为 false） */
export function datePickerOwns(node: Node | null | undefined): boolean {
  if (!node) return false
  return !!livePm?.dom.contains(node) || !!liveCm?.dom.contains(node)
}

/* ---------- 移动高亮日（视图跟着翻页） ---------- */

function setCursor(day: LocalDate): void {
  datePicker.cursor = day
  datePicker.year = day.y
  datePicker.month = day.m
}

/** 按天移动（← → ±1、↑ ↓ ±7），跨月跨年由 Date 进位 */
export function moveCursor(days: number): void {
  const c = datePicker.cursor
  setCursor(toLocal(new Date(c.y, c.m, c.d + days)))
}

/** 按月移动（PageUp/PageDown 与 ‹ › « »）：落在同一天，月末对不上时取目标月最后一天（31 → 2-28） */
export function moveCursorMonths(months: number): void {
  const c = datePicker.cursor
  const base = new Date(c.y, c.m + months, 1)
  const y = base.getFullYear()
  const m = base.getMonth()
  setCursor({ y, m, d: Math.min(c.d, daysInMonth(y, m)) })
}

/* ---------- 插入 ---------- */

/** 插入所选日期（替换当前选区，光标落在日期后）并收起 */
export function insertDatePick(day: LocalDate): boolean {
  const text = isoOf(day)
  // 打开期间视图可能已被卸载（模式切换/切签后浮层还挂着）：别往拆掉的视图里派发
  const pm = livePm?.dom.isConnected ? livePm : null
  const cm = liveCm?.dom.isConnected ? liveCm : null
  closeDatePicker()
  if (pm) {
    const sel = pm.state.selection
    if (!(sel instanceof TextSelection)) return false
    pm.dispatch(pm.state.tr.insertText(text, sel.from, sel.to).scrollIntoView())
    pm.focus()
    return true
  }
  if (cm) {
    const { from, to } = cm.state.selection.main
    cm.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length }
    })
    cm.focus()
    return true
  }
  return false
}
