import { reactive } from 'vue'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView as PmView } from '@milkdown/kit/prose/view'
import type { EditorView as CmView } from '@codemirror/view'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { t } from '@/i18n'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { findTableSelection } from './pm-element-toolbar'
import { writeClipboard } from './code-copy'
import { parseImageLine } from './image-utils'
import { applyTableOp, cellStart, detectTable, type TableInfo, type TableOp } from './table-utils'
import {
  clearColWidths,
  getColWidths,
  headerKeyOf,
  refreshTableWidths,
  resetTableWidth,
  tableKey,
} from './table-widths'

/**
 * 表格右键菜单（ROADMAP 2.3/2.2，复刻 ImageContextMenu 模式，条目/动作为数据层）：
 * - 捕获 contextmenu：即显面板内的 table 元素（图片/math 上让位给图片菜单）、
 *   源码/双栏点击坐标处的表格语法（CodeMirror posAtCoords → detectTable）、
 *   预览面板内的 table 元素（只读：仅提供复制与列宽重置）→ 弹菜单
 * - 结构操作：源码侧走 table-utils 纯文本变换（单事务可撤销）；即显侧委托
 *   WysiwygEditor 注册的执行器（Milkdown gfm 命令，光标已被右键落到点击单元格）
 * - 复制表格 = 表格块源码（CM）/ 单元格文本逐行（PM/预览）
 * - 自适应宽度 = 清除该表的会话列宽记忆与内联宽度（即显/预览）
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
  | 'auto-width'
  | 'table-delete'

export const tableMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  canRow: true,
  canCol: true,
  /** 预览（只读）面板：仅复制/列宽重置可用 */
  readOnly: false
})

type Target =
  | { kind: 'cm'; view: CmView; info: TableInfo }
  | { kind: 'pm' }
  | { kind: 'preview'; table: HTMLTableElement }
let target: Target | null = null

/** 即显侧执行器（WysiwygEditor 挂载时注册）：菜单动作 → Milkdown gfm 命令 */
export type PmTableExecutor = (action: TableMenuAction) => boolean
let pmExecutor: PmTableExecutor | null = null
export function registerPmTableExecutor(fn: PmTableExecutor | null): void {
  pmExecutor = fn
}

export function openTableMenu(
  x: number,
  y: number,
  canRow: boolean,
  canCol: boolean,
  tgt: Target
): void {
  target = tgt
  tableMenu.open = true
  tableMenu.x = x
  tableMenu.y = y
  tableMenu.canRow = canRow
  tableMenu.canCol = canCol
  tableMenu.readOnly = tgt.kind === 'preview'
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
  const ro = tableMenu.readOnly
  return [
    { action: 'row-above', label: t('table.addRowAbove'), disabled: ro },
    { action: 'row-below', label: t('table.addRowBelow'), disabled: ro },
    { action: 'row-delete', label: t('table.deleteRow'), disabled: ro || !tableMenu.canRow },
    { action: 'col-left', label: t('table.addColLeft'), disabled: ro },
    { action: 'col-right', label: t('table.addColRight'), disabled: ro },
    { action: 'col-delete', label: t('table.deleteCol'), disabled: ro || !tableMenu.canCol },
    { action: 'align-left', label: t('table.alignLeft'), disabled: ro },
    { action: 'align-center', label: t('table.alignCenter'), disabled: ro },
    { action: 'align-right', label: t('table.alignRight'), disabled: ro },
    { action: 'align-none', label: t('table.alignNone'), disabled: ro },
    { action: 'copy-table', label: t('table.copyTable') },
    { action: 'auto-width', label: t('table.autoWidth') },
    { action: 'to-text', label: t('table.toText'), disabled: ro },
    { action: 'table-delete', label: t('table.deleteTable'), disabled: ro, danger: true }
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

  if (action === 'auto-width') {
    // 源码里没有内联宽度，只需清记忆（预览/即显下次渲染恢复自适应）。
    // 键 = 标签 + 文档内表格序号 + 表头：同名表头的其他表格不受影响
    const header = lines[0]
      ? lines[0]
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split(/(?<!\\)\|/)
          .map((c) => c.trim())
          .join('\u0001')
      : ''
    let index = 0
    let inTable = false
    for (let n = 1; n < info.startLine; n++) {
      const row = /^\s*\|/.test(view.state.doc.line(n).text)
      if (row && !inTable) {
        inTable = true
        index++
      } else if (!row) inTable = false
    }
    clearColWidths(tableKey(useDocumentsStore().activeId ?? 'x', index, header))
    return
  }

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
          .replace(/\|$/, '')
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

/** 预览侧执行（只读视图：复制 / 列宽重置） */
function runPreviewAction(table: HTMLTableElement, action: TableMenuAction): void {
  if (action === 'auto-width') {
    const body = table.closest('.md-preview') ?? document
    const tables = Array.from(body.querySelectorAll('table'))
    const index = tables.indexOf(table)
    clearColWidths(tableKey(useDocumentsStore().activeId ?? 'x', index, headerKeyOf(table)))
    resetTableWidth(table)
    return
  }
  if (action === 'copy-table') {
    const lines: string[] = []
    for (const row of Array.from(table.rows)) {
      const cells = Array.from(row.cells).map((c) => (c.textContent ?? '').trim())
      lines.push(`| ${cells.join(' | ')} |`)
    }
    void writeClipboard(lines.join('\n'))
  }
}

/** 执行菜单动作（TableContextMenu.vue 调用） */
export function runTableMenuAction(action: TableMenuAction): void {
  closeTableMenu()
  if (!target) return
  const tgt = target
  target = null
  if (tgt.kind === 'pm') {
    pmExecutor?.(action)
    return
  }
  if (tgt.kind === 'preview') {
    runPreviewAction(tgt.table, action)
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
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY })
    const pos = hit?.pos
    if (pos != null && pos >= 0 && pos <= view.state.doc.content.size) {
      try {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
      } catch {
        /* 落点不可解析：保持原选区 */
      }
    }
    // 行列可删性按落位后的选区复算：表头不可删、只剩单列时不可删列
    const meta = findTableSelection(view)
    openTableMenu(e.clientX, e.clientY, meta?.canDeleteRow ?? false, meta?.canDeleteCol ?? false, {
      kind: 'pm'
    })
    return
  }

  // 预览面板：只读，但列宽重置/复制可用
  const pvTable = el.closest('.md-preview table')
  if (pvTable instanceof HTMLTableElement) {
    e.preventDefault()
    e.stopPropagation()
    openTableMenu(e.clientX, e.clientY, true, true, { kind: 'preview', table: pvTable })
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

/** 供组件层查询「某表是否已有列宽记忆」（右键禁用态/工具提示用） */
export function tableHasWidths(table: HTMLTableElement): boolean {
  return !!getColWidths(headerKeyOf(table))
}

/** 即显侧装饰器刷新入口（供组件复用） */
export function requestTableWidthsRefresh(view: PmView): void {
  refreshTableWidths(view)
}
