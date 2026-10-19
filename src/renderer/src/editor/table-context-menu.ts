import { reactive } from 'vue'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView as CmView } from '@codemirror/view'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { writeClipboard } from './code-copy'
import { parseImageLine } from './image-utils'
import { applyTableOp, cellStart, detectTable, type TableInfo, type TableOp } from './table-utils'

/**
 * 表格右键菜单（ROADMAP 2.3，复刻 ImageContextMenu 模式，条目/动作为数据层）：
 * - 捕获 contextmenu：即显面板内的 table 元素（图片/math 上让位给图片菜单）、
 *   源码/双栏点击坐标处的表格语法（CodeMirror posAtCoords → detectTable）→ 弹菜单
 * - 结构操作：源码侧走 table-utils 纯文本变换（单事务可撤销）；即显侧委托
 *   WysiwygEditor 注册的执行器（Milkdown gfm 命令，光标已被右键落到点击单元格）
 * - 复制表格 = 表格块源码（CM）/ 单元格文本逐行（PM）；转文本 = 去管道逐行、
 *   制表符分隔（表格语义丢失，不可逆）
 */

export type TableMenuAction =
  | 'row-above'
  | 'row-below'
  | 'row-delete'
  | 'col-left'
  | 'col-right'
  | 'col-delete'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-none'
  | 'copy-table'
  | 'to-text'
  | 'table-delete'

export const tableMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  /** 行/列可删性（表头/分隔行、仅剩单行/单列时禁用） */
  canRow: true,
  canCol: true
})

type Target = { kind: 'cm'; view: CmView; info: TableInfo } | { kind: 'pm' }
let target: Target | null = null

/** 即显侧执行器（WysiwygEditor 挂载时注册）：菜单动作 → Milkdown gfm 命令 */
export type PmTableExecutor = (action: TableMenuAction) => boolean
let pmExecutor: PmTableExecutor | null = null
export function registerPmTableExecutor(fn: PmTableExecutor | null): void {
  pmExecutor = fn
}

export function openTableMenu(x: number, y: number, canRow: boolean, canCol: boolean, tgt: Target): void {
  target = tgt
  tableMenu.open = true
  tableMenu.x = x
  tableMenu.y = y
  tableMenu.canRow = canRow
  tableMenu.canCol = canCol
}

export function closeTableMenu(): void {
  tableMenu.open = false
}

export interface TableMenuItem {
  action: TableMenuAction
  label: string
  disabled?: boolean
  danger?: boolean
}

export function tableMenuItems(): TableMenuItem[] {
  return [
    { action: 'row-above', label: t('table.addRowAbove') },
    { action: 'row-below', label: t('table.addRowBelow') },
    { action: 'row-delete', label: t('table.deleteRow'), disabled: !tableMenu.canRow },
    { action: 'col-left', label: t('table.addColLeft') },
    { action: 'col-right', label: t('table.addColRight') },
    { action: 'col-delete', label: t('table.deleteCol'), disabled: !tableMenu.canCol },
    { action: 'align-left', label: t('table.alignLeft') },
    { action: 'align-center', label: t('table.alignCenter') },
    { action: 'align-right', label: t('table.alignRight') },
    { action: 'align-none', label: t('table.alignNone') },
    { action: 'copy-table', label: t('table.copyTable') },
    { action: 'to-text', label: t('table.toText') },
    { action: 'table-delete', label: t('table.deleteTable'), danger: true }
  ]
}

/* ---------- 源码（CodeMirror）侧执行 ---------- */

function cmBlockText(view: CmView, info: TableInfo): string[] {
  const lines: string[] = []
  for (let n = info.startLine; n <= info.endLine; n++) lines.push(view.state.doc.line(n).text)
  return lines
}

function runCmTableAction(view: CmView, info: TableInfo, action: TableMenuAction): void {
  const lines = cmBlockText(view, info)
  const blockFrom = view.state.doc.line(info.startLine).from
  const blockTo = view.state.doc.line(info.endLine).to

  if (action === 'copy-table') {
    void writeClipboard(lines.join('\n'))
    return
  }
  if (action === 'to-text') {
    const text = lines
      .filter((_, i) => i !== 1) // 丢弃分隔行
      .map((l) =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|(?=[^|]*$)/, '') // 去尾管道（转义 \| 不受影响）
          .split(/(?<!\\)\|/)
          .map((c) => c.trim())
          .join('\t')
      )
      .join('\n')
    view.dispatch({ changes: { from: blockFrom, to: blockTo, insert: text } })
    view.focus()
    return
  }

  const op: TableOp =
    action === 'table-delete'
      ? { kind: 'table-delete' }
      : action === 'align-left'
        ? { kind: 'align', how: 'left' }
        : action === 'align-center'
          ? { kind: 'align', how: 'center' }
          : action === 'align-right'
            ? { kind: 'align', how: 'right' }
            : action === 'align-none'
              ? { kind: 'align', how: 'none' }
              : { kind: action }
  const edit = applyTableOp(lines, info, op)
  if (!edit) return
  const anchor =
    edit.lines.length === 0
      ? blockFrom
      : blockFrom +
        edit.lines.slice(0, Math.min(edit.cursorLine, edit.lines.length - 1)).reduce(
          (acc, text) => acc + text.length + 1,
          0
        ) +
        cellStart(edit.lines[Math.min(edit.cursorLine, edit.lines.length - 1)], edit.cursorCol)
  view.dispatch({
    changes: { from: blockFrom, to: blockTo, insert: edit.lines.join('\n') },
    selection: { anchor }
  })
  view.focus()
}

/** 执行菜单动作（TableMenu.vue 调用） */
export function runTableMenuAction(action: TableMenuAction): void {
  closeTableMenu()
  if (!target) return
  const tgt = target
  target = null
  if (tgt.kind === 'pm') {
    pmExecutor?.(action)
    return
  }
  runCmTableAction(tgt.view, tgt.info, action)
}

/* ---------- 全局识别（App.vue 挂载时调用 init） ---------- */

function onContext(e: MouseEvent): void {
  const el = e.target as HTMLElement | null
  if (!el || !el.closest) return

  // 即显面板：表格元素上弹菜单（图片/公式上让位给图片右键菜单）
  if (el.closest('.ProseMirror')) {
    const tableEl = el.closest('table')
    if (!tableEl || el.closest('img, math-inline, math-block')) {
      closeTableMenu()
      return
    }
    const view = pmViews().find((v) => v.dom.contains(tableEl))
    if (!view) {
      closeTableMenu()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    // 显式把光标落到点击单元格：行列操作按选区定位，真实右键虽由 Chromium
    // 落位，但合成/异常路径不保证；落位失败（坐标无效）则保持原选区
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY })
    const pos = hit?.pos
    if (pos != null && pos >= 0 && pos <= view.state.doc.content.size) {
      try {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
      } catch {
        /* 落点不可解析：保持原选区 */
      }
    }
    openTableMenu(e.clientX, e.clientY, true, true, { kind: 'pm' })
    return
  }

  // 源码/双栏：点击坐标 → 文档位置 → 表格检测（右键不移动 CM 光标，按坐标算）
  for (const view of cmViews()) {
    if (!view.dom.contains(el)) continue
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos == null) continue
    const line = view.state.doc.lineAt(pos)
    if (parseImageLine(line.text)) continue // 图片语法行让位给图片菜单
    const info = detectTable(
      view.state.doc.lines,
      (n) => view.state.doc.line(n).text,
      line.number,
      pos - line.from
    )
    if (!info) {
      closeTableMenu()
      continue
    }
    e.preventDefault()
    e.stopPropagation()
    openTableMenu(e.clientX, e.clientY, info.cursorLine > info.startLine + 1, info.colCount > 1, {
      kind: 'cm',
      view,
      info
    })
    return
  }
  closeTableMenu()
}

export function initTableContextMenu(): void {
  window.addEventListener('contextmenu', onContext, true)
}
