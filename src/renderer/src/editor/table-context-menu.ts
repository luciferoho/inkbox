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
import { cmdBold, cmdInlineCode, cmdItalic, cmdLink, cmdStrike } from './cm-commands'
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
  | 'cut'
  | 'copy'
  | 'paste'
  | 'bold'
  | 'italic'
  | 'inline-code'
  | 'strike'
  | 'link'
  | 'row-above'
  | 'row-below'
  | 'row-delete'
  | 'row-move-up'
  | 'row-move-down'
  | 'col-left'
  | 'col-right'
  | 'col-delete'
  | 'col-move-left'
  | 'col-move-right'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-none'
  | 'copy-table'
  | 'format-table'
  | 'to-text'
  | 'auto-width'
  | 'table-delete'

export const tableMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  canRow: true,
  canCol: true,
  canAbove: true,
  /** 当前列是否还能左移/右移（第一列禁左移、最后一列禁右移） */
  canMoveLeft: true,
  canMoveRight: true,
  /** 当前行是否还能上移/下移（表头、首数据行禁上移；末行禁下移） */
  canMoveRowUp: true,
  canMoveRowDown: true,
  /** 预览（只读）面板：仅复制与列宽重置可用 */
  readOnly: false,
  /** 弹菜单时的面板类型（「格式化表格源码」只在 cm 提供） */
  targetKind: 'pm' as Target['kind']
})

type Target =
  | { kind: 'cm'; view: CmView; info: TableInfo }
  | { kind: 'pm'; view: PmView }
  | { kind: 'preview'; table: HTMLTableElement }
let target: Target | null = null

/** 即显侧执行器（WysiwygEditor 挂载时注册）：菜单动作 → Milkdown gfm 命令 */
export type PmTableExecutor = (action: TableMenuAction) => boolean
let pmExecutor: PmTableExecutor | null = null
export function registerPmTableExecutor(fn: PmTableExecutor | null): void {
  pmExecutor = fn
}

export interface OpenTableMenuOpts {
  canRow: boolean
  canCol: boolean
  canAbove: boolean
  canMoveLeft?: boolean
  canMoveRight?: boolean
  canMoveRowUp?: boolean
  canMoveRowDown?: boolean
}

export function openTableMenu(
  x: number,
  y: number,
  opts: OpenTableMenuOpts,
  tgt: Target
): void {
  target = tgt
  tableMenu.open = true
  tableMenu.x = x
  tableMenu.y = y
  tableMenu.canRow = opts.canRow
  tableMenu.canCol = opts.canCol
  tableMenu.canAbove = opts.canAbove
  tableMenu.canMoveLeft = opts.canMoveLeft ?? false
  tableMenu.canMoveRight = opts.canMoveRight ?? false
  tableMenu.canMoveRowUp = opts.canMoveRowUp ?? false
  tableMenu.canMoveRowDown = opts.canMoveRowDown ?? false
  tableMenu.readOnly = tgt.kind === 'preview'
  tableMenu.targetKind = tgt.kind
}

export function closeTableMenu(): void {
  tableMenu.open = false
}

export interface TableMenuItem {
  /** 分隔线条目无动作（sep: true） */
  action?: TableMenuAction
  label: string
  /** 展示用快捷键文案（快捷键已实际绑定：Alt+方向键 行/列移动） */
  accel?: string
  disabled?: boolean
  danger?: boolean
  /** 分隔线（label === '-'） */
  sep?: boolean
}

export interface TableMenuGroup {
  id: 'format' | 'row' | 'col' | 'table'
  label: string
  items: TableMenuItem[]
}

/** 菜单顶部直接列出的项（Typora 表格右键同样把剪贴板放最上） */
export function tableMenuTop(state: { readOnly: boolean }): TableMenuItem[] {
  const ro = state.readOnly
  return [
    { action: 'cut', label: t('ctx.cut'), accel: 'Ctrl+X', disabled: ro },
    { action: 'copy', label: t('ctx.copy'), accel: 'Ctrl+C' },
    { action: 'paste', label: t('ctx.paste'), accel: 'Ctrl+V', disabled: ro }
  ]
}

/** 常用格式组（Typora 表格右键在表格操作之上还带 B/I/代码/链接） */
function formatGroup(readOnly: boolean): TableMenuGroup {
  return {
    id: 'format',
    label: t('table.groupFormat'),
    items: [
      { action: 'bold', label: t('table.fmtBold'), accel: 'Ctrl+B', disabled: readOnly },
      { action: 'italic', label: t('table.fmtItalic'), accel: 'Ctrl+I', disabled: readOnly },
      { action: 'inline-code', label: t('table.fmtCode'), accel: 'Ctrl+Shift+C', disabled: readOnly },
      { action: 'strike', label: t('table.fmtStrike'), accel: 'Ctrl+Shift+X', disabled: readOnly },
      { action: 'link', label: t('table.fmtLink'), accel: 'Ctrl+K', disabled: readOnly }
    ]
  }
}

/** 菜单按 行/列/整表 三模块分组（子菜单，2026-10-31 用户要求对齐 Typora 且更好找）。
 *  - 「格式化表格源码」只在源码/双栏提供（即显/预览没有源码概念，点了也看不见变化）
 *  - 预览（只读）只给「整表」组：复制表格 + 自适应宽度 */
export function tableMenuGroups(targetKind: Target['kind']): TableMenuGroup[] {
  const ro = tableMenu.readOnly
  const cmOnly = targetKind === 'cm'
  const rowGroup: TableMenuGroup = {
    id: 'row',
    label: t('table.groupRow'),
    items: [
      { action: 'row-above', label: t('table.addRowAbove'), disabled: ro || !tableMenu.canAbove },
      { action: 'row-below', label: t('table.addRowBelow'), disabled: ro, accel: 'Ctrl+Enter' },
      { action: 'row-move-up', label: t('table.moveRowUp'), disabled: ro || !tableMenu.canMoveRowUp, accel: 'Alt+↑' },
      { action: 'row-move-down', label: t('table.moveRowDown'), disabled: ro || !tableMenu.canMoveRowDown, accel: 'Alt+↓' },
      { action: 'row-delete', label: t('table.deleteRow'), disabled: ro || !tableMenu.canRow, accel: 'Ctrl+Shift+⌫' }
    ]
  }
  const colGroup: TableMenuGroup = {
    id: 'col',
    label: t('table.groupCol'),
    items: [
      { action: 'col-left', label: t('table.addColLeft'), disabled: ro },
      { action: 'col-right', label: t('table.addColRight'), disabled: ro },
      { action: 'col-move-left', label: t('table.moveColLeft'), disabled: ro || !tableMenu.canMoveLeft, accel: 'Alt+←' },
      { action: 'col-move-right', label: t('table.moveColRight'), disabled: ro || !tableMenu.canMoveRight, accel: 'Alt+→' },
      { action: 'col-delete', label: t('table.deleteCol'), disabled: ro || !tableMenu.canCol },
      { sep: true, label: '-' },
      { action: 'align-left', label: t('table.alignLeft'), disabled: ro },
      { action: 'align-center', label: t('table.alignCenter'), disabled: ro },
      { action: 'align-right', label: t('table.alignRight'), disabled: ro },
      { action: 'align-none', label: t('table.alignNone'), disabled: ro }
    ]
  }
  const tableGroup: TableMenuGroup = {
    id: 'table',
    label: t('table.groupTable'),
    items: [
      { action: 'copy-table', label: t('table.copyTable') },
      ...(cmOnly
        ? ([{ action: 'format-table', label: t('table.formatTable'), disabled: ro }] as TableMenuItem[])
        : []),
      { action: 'to-text', label: t('table.toText'), disabled: ro },
      { action: 'auto-width', label: t('table.autoWidth') },
      { sep: true, label: '-' },
      { action: 'table-delete', label: t('table.deleteTable'), disabled: ro, danger: true }
    ]
  }
  if (ro) {
    return [
      { id: 'table', label: t('table.groupTable'), items: [
        { action: 'copy-table', label: t('table.copyTable') },
        { action: 'auto-width', label: t('table.autoWidth') }
      ] }
    ]
  }
  return [formatGroup(false), rowGroup, colGroup, tableGroup]
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
  // 常用格式/剪贴板走通用执行路径（runTableMenuAction 已分发），到这里只处理结构操作
  if (
    action === 'cut' ||
    action === 'copy' ||
    action === 'paste' ||
    action === 'bold' ||
    action === 'italic' ||
    action === 'inline-code' ||
    action === 'strike' ||
    action === 'link'
  ) {
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
              : action === 'row-move-up'
                ? { kind: 'row-up' }
                : action === 'row-move-down'
                  ? { kind: 'row-down' }
                  : action === 'format-table'
                    ? { kind: 'format-table' }
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
/** 剪贴板动作（系统语义；粘贴走 navigator 读文本插入） */
function runClipboardAction(view: PmView | CmView, action: 'cut' | 'copy' | 'paste'): void {
  if (action === 'copy') {
    document.execCommand('copy')
    return
  }
  if (action === 'cut') {
    document.execCommand('cut')
    return
  }
  void (async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      if ('dispatch' in view && 'state' in view && view.dom.classList.contains('ProseMirror')) {
        const pm = view as PmView
        if (!(pm.state.selection instanceof TextSelection)) return
        const { from, to } = pm.state.selection
        pm.dispatch(pm.state.tr.insertText(text, from, to))
        return
      }
      const cm = view as CmView
      const head = cm.state.selection.main.head
      cm.dispatch({
        changes: { from: head, insert: text },
        selection: { anchor: head + text.length }
      })
    } catch {
      /* 剪贴板权限受限：静默放弃 */
    }
  })()
}

export function runTableMenuAction(action: TableMenuAction): void {
  closeTableMenu()
  if (!target) return
  const tgt = target
  target = null
  if (tgt.kind === 'pm') {
    pmExecutor?.(action)
    tgt.view.focus() // 菜单点击会抢焦点：操作后交还编辑器，Ctrl+Z 才能直接生效
    return
  }
  if (tgt.kind === 'preview') {
    runPreviewAction(tgt.table, action)
    return
  }
  if (action === 'cut' || action === 'copy' || action === 'paste') {
    tgt.view.focus()
    runClipboardAction(tgt.view, action)
    return
  }
  if (action === 'bold') cmdBold(tgt.view)
  else if (action === 'italic') cmdItalic(tgt.view)
  else if (action === 'inline-code') cmdInlineCode(tgt.view)
  else if (action === 'strike') cmdStrike(tgt.view)
  else if (action === 'link') cmdLink(tgt.view)
  else runCmTableAction(tgt.view, tgt.info, action)
  tgt.view.focus() // 同上：复制/自适应等提前 return 的路径也恢复焦点
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
      // 右键点落在已有选区内时保留选区——否则「选中单元格文字 → 右键加粗」会
      // 被这里的落点重置折叠掉，格式动作拿不到选区（表现为点了没反应）
      const sel = view.state.selection
      const inside = !sel.empty && pos >= sel.from && pos <= sel.to
      if (!inside) {
        try {
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
        } catch {
          /* 落点不可解析：保持原选区 */
        }
      }
    }
    // 行列可删性按落位后的选区复算：表头不可删/不可上方插入、只剩单列时不可删列
    const meta = findTableSelection(view)
    const tNode = meta ? view.state.doc.nodeAt(meta.pos) : null
    const colCount = tNode && tNode.childCount > 0 ? tNode.child(0).childCount : 0
    const rowCount = tNode ? tNode.childCount : 0
    openTableMenu(
      e.clientX,
      e.clientY,
      {
        canRow: meta?.canDeleteRow ?? false,
        canCol: meta?.canDeleteCol ?? false,
        canAbove: (meta?.row ?? 0) >= 1,
        // 第一列禁左移、最后一列禁右移（与删列的边界一致）
        canMoveLeft: !!meta && meta.col > 0,
        canMoveRight: !!meta && colCount > 0 && meta.col < colCount - 1,
        // 行移动边界：表头(0)/首个数据行(1)禁上移；末行禁下移（row0 是表头行）
        canMoveRowUp: !!meta && meta.row >= 2,
        canMoveRowDown: !!meta && meta.row >= 1 && meta.row < rowCount - 1
      },
      { kind: 'pm', view }
    )
    return
  }

  // 预览面板：只读，但列宽重置/复制可用
  const pvTable = el.closest('.md-preview table')
  if (pvTable instanceof HTMLTableElement) {
    e.preventDefault()
    e.stopPropagation()
    // 预览只读，移动列禁用；禁用态仍按落点列号计算（第一列左移灰、末列右移灰）
    const cell = el.closest('td, th')
    const idx = cell instanceof HTMLTableCellElement ? cell.cellIndex : 0
    const parent = cell instanceof HTMLTableCellElement ? cell.parentElement : null
    const count = parent instanceof HTMLTableRowElement ? parent.cells.length : 1
    openTableMenu(
      e.clientX,
      e.clientY,
      {
        canRow: true,
        canCol: true,
        canAbove: false,
        canMoveLeft: idx > 0,
        canMoveRight: idx < count - 1
      },
      { kind: 'preview', table: pvTable }
    )
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
    const blockIdx = info.cursorLine - info.startLine
    openTableMenu(
      e.clientX,
      e.clientY,
      {
        canRow: info.cursorLine > info.startLine + 1,
        canCol: info.colCount > 1,
        canAbove: info.cursorLine > info.startLine + 1,
        canMoveLeft: info.colIndex > 0,
        canMoveRight: info.colIndex < info.colCount - 1,
        // 行移动边界：表头(0)/分隔行(1)/首个数据行(2)禁上移；末行禁下移
        canMoveRowUp: blockIdx >= 3,
        canMoveRowDown: blockIdx >= 2 && info.cursorLine < info.endLine
      },
      { kind: 'cm', view, info }
    )
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
