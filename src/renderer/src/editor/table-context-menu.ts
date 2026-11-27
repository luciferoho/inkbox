import { reactive } from 'vue'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { CellSelection, deleteCellSelection, selectedRect } from '@milkdown/kit/prose/tables'
import type { EditorView as PmView } from '@milkdown/kit/prose/view'
import type { EditorView as CmView } from '@codemirror/view'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { t } from '@/i18n'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { findTableSelection } from './pm-element-toolbar'
import { writeClipboard, writeClipboardRich } from './code-copy'
import { parseImageLine } from './image-utils'
import {
  applyTableOp,
  cellStart,
  detectTable,
  gfmTable,
  splitCells,
  tableSelectionSpan,
  type TableInfo,
  type TableOp,
  type TableSpan
} from './table-utils'
import { cmdBold, cmdInlineCode, cmdItalic, cmdLink, cmdStrike } from './cm-commands'
import { tryPmSmartPaste } from './paste-smart'
import { pmClipboardData } from './table-cell-copy'
import { readClipboardText } from '@/services/clipboard'
import { cmPasteTsv } from './tsv-paste'
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
  | 'copy-tsv'
  | 'col-sort-asc'
  | 'col-sort-desc'
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
  /** 多选时将被批量删除的行/列数（0 = 按右键落点单行/单列） */
  rowBatch: 0,
  colBatch: 0,
  /** 右键「复制/剪切」是否有可复制的内容（无选中时置灰：复制只针对选中内容，
   *  整表复制走「整表操作 → 复制表格」） */
  canCopy: false,
  canCut: false,
  /** 预览（只读）面板：仅复制与列宽重置可用 */
  readOnly: false,
  /** 弹菜单时的面板类型（「格式化表格源码」只在 cm 提供） */
  targetKind: 'pm' as Target['kind']
})

type Target =
  | { kind: 'cm'; view: CmView; info: TableInfo; span: TableSpan | null }
  /** tablePos：右键落点所在表格的文档位置。表格动作以它为准，不依赖当前选区——
   *  落点在单元格边框/滚动壳上时 posAtCoords 可能给不出位置，选区会停留在上一次
   *  的表格里，导致「复制 A 却复制成 B」 */
  | { kind: 'pm'; view: PmView; tablePos?: number }
  | { kind: 'preview'; table: HTMLTableElement }
let target: Target | null = null

/** 即显侧执行器（WysiwygEditor 挂载时注册）：菜单动作 → Milkdown gfm 命令 */
export type PmTableExecutor = (action: TableMenuAction, tablePos?: number) => boolean
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
  rowBatch?: number
  colBatch?: number
  /** 右键是否有可复制/剪切的内容（无选中时置灰） */
  canCopy?: boolean
  canCut?: boolean
}

/** 即显多选的单元格矩形（行列 0 基，bottom/right 不含）；非 CellSelection 返回 null */
export function pmTableSpan(
  state: EditorState
): { pos: number; top: number; bottom: number; left: number; right: number } | null {
  if (!(state.selection instanceof CellSelection)) return null
  const r = selectedRect(state)
  return { pos: r.tableStart - 1, top: r.top, bottom: r.bottom, left: r.left, right: r.right }
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
  tableMenu.rowBatch = opts.rowBatch ?? 0
  tableMenu.colBatch = opts.colBatch ?? 0
  tableMenu.canCopy = opts.canCopy ?? false
  tableMenu.canCut = opts.canCut ?? false
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
export function tableMenuTop(state: { readOnly: boolean; canCopy: boolean; canCut: boolean }): TableMenuItem[] {
  const ro = state.readOnly
  return [
    { action: 'cut', label: t('ctx.cut'), accel: 'Ctrl+X', disabled: ro || !state.canCut },
    // 复制只针对选中内容；整表复制在「整表操作 → 复制表格」
    { action: 'copy', label: t('ctx.copy'), accel: 'Ctrl+C', disabled: !state.canCopy },
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

/** 菜单底部的一级项：「格式化表格源码」只在源码/双栏提供（即显/预览看不到 | 分隔符） */
export function tableMenuTail(targetKind: Target['kind']): TableMenuItem[] {
  return targetKind === 'cm' ? [{ action: 'format-table', label: t('table.formatTable') }] : []
}

/** 菜单按 行/列/整表 三模块分组（子菜单，2026-10-31 用户要求对齐 Typora 且更好找）。
 *  - 预览（只读）只给「整表」组：复制表格 + 自适应宽度 */
export function tableMenuGroups(): TableMenuGroup[] {
  const ro = tableMenu.readOnly
  const { rowBatch, colBatch } = tableMenu
  const rowGroup: TableMenuGroup = {
    id: 'row',
    label: t('table.groupRow'),
    items: [
      { action: 'row-above', label: t('table.addRowAbove'), disabled: ro || !tableMenu.canAbove },
      { action: 'row-below', label: t('table.addRowBelow'), disabled: ro, accel: 'Ctrl+Enter' },
      { action: 'row-move-up', label: t('table.moveRowUp'), disabled: ro || !tableMenu.canMoveRowUp, accel: 'Alt+↑' },
      { action: 'row-move-down', label: t('table.moveRowDown'), disabled: ro || !tableMenu.canMoveRowDown, accel: 'Alt+↓' },
      rowBatch > 0
        ? { action: 'row-delete', label: t('table.deleteRows', { n: rowBatch }), disabled: ro || !tableMenu.canRow }
        : { action: 'row-delete', label: t('table.deleteRow'), disabled: ro || !tableMenu.canRow, accel: 'Ctrl+Shift+⌫' }
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
      {
        action: 'col-delete',
        label: colBatch > 0 ? t('table.deleteCols', { n: colBatch }) : t('table.deleteCol'),
        disabled: ro || !tableMenu.canCol
      },
      { action: 'col-sort-asc', label: t('table.sortAsc'), disabled: ro },
      { action: 'col-sort-desc', label: t('table.sortDesc'), disabled: ro },
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
      { action: 'copy-tsv', label: t('table.copyTsv') },
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
        { action: 'copy-tsv', label: t('table.copyTsv') },
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

function runCmTableAction(
  view: CmView,
  info: TableInfo,
  action: TableMenuAction,
  span: TableSpan | null
): void {
  const lines = cmBlockText(view, info)
  const before = lines.join('\n')
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
  if (action === 'copy-tsv') {
    // 复制为 TSV（6.4b）：丢分隔行，逐行单元格制表符连接，Excel 可直接贴
    void writeClipboard(
      lines
        .filter((_, i) => i !== 1)
        .map((l) => splitCells(l).join('\t'))
        .join('\n')
    )
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

  const batchOp: TableOp | null =
    action === 'row-delete' && span && span.rowTo > span.rowFrom
      ? { kind: 'rows-delete', from: span.rowFrom, to: span.rowTo }
      : action === 'col-delete' && span && span.colTo > span.colFrom
        ? { kind: 'cols-delete', from: span.colFrom, to: span.colTo }
        : null
  const singleOp: TableOp =
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
                    : action === 'col-sort-asc'
                      ? { kind: 'col-sort', dir: 'asc' }
                      : action === 'col-sort-desc'
                        ? { kind: 'col-sort', dir: 'desc' }
                        : { kind: action }
  const edit = applyTableOp(lines, info, batchOp ?? singleOp)
  if (!edit) return
  if (action === 'format-table' && edit.lines.join('\n') === before) return // 已对齐：不动光标也不标脏
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
  // 对齐只改空白，与磁盘内容「等价」不会自动标脏；这是用户明确要落盘的改动
  if (action === 'format-table') {
    const docs = useDocumentsStore()
    if (docs.activeId != null) docs.markDirty(docs.activeId)
  }
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
    // 必须带表头分隔行：否则粘回编辑器只是几段带竖线的普通文本（Markdown 不认表格）
    const rows = Array.from(table.rows).map((row) =>
      Array.from(row.cells).map((c) => (c.textContent ?? '').trim())
    )
    const aligns = table.rows[0]
      ? Array.from(table.rows[0].cells).map((c) => ((c as HTMLElement).style.textAlign || null))
      : []
    void writeClipboard(gfmTable(rows, aligns))
    return
  }
  if (action === 'copy-tsv') {
    const rows: string[] = []
    for (const row of Array.from(table.rows)) {
      rows.push(Array.from(row.cells).map((c) => (c.textContent ?? '').trim()).join('\t'))
    }
    void writeClipboard(rows.join('\n'))
  }
}

/** 执行菜单动作（TableContextMenu.vue 调用） */
/** 剪贴板动作：复制/剪切按编辑器状态取内容直写剪贴板，粘贴走解析插入。
 *  不用 document.execCommand('copy')——单元格多选时 PM 的 DOM 选区是折叠的，
 *  命令返回 false、剪贴板保持上次内容，粘出来就是无关的旧东西。 */
function runClipboardAction(view: PmView | CmView, action: 'cut' | 'copy' | 'paste'): void {
  const isPm = 'dispatch' in view && 'state' in view && view.dom.classList.contains('ProseMirror')
  if (action === 'copy' || action === 'cut') {
    if (isPm) {
      const pm = view as PmView
      const data = pmClipboardData(pm.state)
      if (!data) return
      void writeClipboardRich(data.text, data.html).then((ok) => {
        if (!ok) {
          useUiStore().showToast(t('table.copyFailed'))
          return
        }
        if (action !== 'cut') return
        // 写成功后再删，避免写入失败时内容凭空消失
        if (pm.state.selection instanceof CellSelection) deleteCellSelection(pm.state, (tr) => pm.dispatch(tr))
        else pm.dispatch(pm.state.tr.deleteSelection())
      })
      return
    }
    const cm = view as CmView
    const { from, to } = cm.state.selection.main
    const text = cm.state.sliceDoc(from, to)
    if (!text) return
    void writeClipboardRich(text).then((ok) => {
      if (!ok) useUiStore().showToast(t('table.copyFailed'))
      else if (action === 'cut') cm.dispatch({ changes: { from, to, insert: '' } })
    })
    return
  }
  void (async () => {
    let text = ''
    try {
      text = await readClipboardText()
    } catch {
      useUiStore().showToast(t('table.pasteFailed'))
      return
    }
    if (!text) return
    if (isPm) {
      const pm = view as PmView
      // 单元格多选时以选区左上格为落点（WPS：粘贴填入选区起点）
      if (pm.state.selection instanceof CellSelection) {
        const rect = selectedRect(pm.state)
        const table = pm.state.doc.nodeAt(rect.tableStart - 1)
        if (table) {
          let p = rect.tableStart
          for (let i = 0; i < rect.top; i++) p += table.child(i).nodeSize
          p += 1
          for (let j = 0; j < rect.left; j++) p += table.child(rect.top).child(j).nodeSize
          p += 2
          pm.dispatch(pm.state.tr.setSelection(TextSelection.near(pm.state.doc.resolve(p), 1)))
        }
      }
      if (!(pm.state.selection instanceof TextSelection)) return
      // 多行 Markdown / TSV 走与 Ctrl+V 相同的解析链路（表格能真正变成表格）
      if (tryPmSmartPaste(pm, text)) return
      const { from, to } = pm.state.selection
      pm.dispatch(pm.state.tr.insertText(text, from, to))
      return
    }
    const cm = view as CmView
    // TSV（Excel/本应用复制的单元格区域）按表格数据填充，而不是当普通文本插入
    if (cmPasteTsv(cm, text)) return
    const head = cm.state.selection.main.head
    cm.dispatch({
      changes: { from: head, insert: text },
      selection: { anchor: head + text.length }
    })
  })()
}

export function runTableMenuAction(action: TableMenuAction): void {
  closeTableMenu()
  if (!target) return
  const tgt = target
  target = null
  // 剪贴板动作必须走通用路径：即显表格的目标先被上面 kind==='pm' 截走交给执行器，
  // 而执行器对 cut/copy/paste 返回 false —— 不提前分流，表格右键的「粘贴」是空操作
  if ((action === 'cut' || action === 'copy' || action === 'paste') && 'view' in tgt) {
    tgt.view.focus()
    runClipboardAction(tgt.view, action)
    return
  }
  if (tgt.kind === 'pm') {
    pmExecutor?.(action, tgt.tablePos)
    tgt.view.focus() // 菜单点击会抢焦点：操作后交还编辑器，Ctrl+Z 才能直接生效
    return
  }
  if (tgt.kind === 'preview') {
    runPreviewAction(tgt.table, action)
    return
  }
  if (action === 'bold') cmdBold(tgt.view)
  else if (action === 'italic') cmdItalic(tgt.view)
  else if (action === 'inline-code') cmdInlineCode(tgt.view)
  else if (action === 'strike') cmdStrike(tgt.view)
  else if (action === 'link') cmdLink(tgt.view)
  else runCmTableAction(tgt.view, tgt.info, action, tgt.span)
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
    // 落点在单元格边框/滚动壳上时 posAtCoords 可能返回 null：退回按被点单元格取位置，
    // 否则选区停在旧表格，后续「复制表格」会复制错表（用户实测：复制 A 粘出 B）
    let pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null
    if (pos == null) {
      const cellEl = el.closest('td, th')
      if (cellEl) {
        try {
          pos = view.posAtDOM(cellEl, 0)
        } catch {
          /* 位置不可解析：保持原选区 */
        }
      }
    }
    if (pos != null && pos >= 0 && pos <= view.state.doc.content.size) {
      // 右键点落在已有选区内时保留选区——否则「选中单元格文字 → 右键加粗」会
      // 被这里的落点重置折叠掉，格式动作拿不到选区（表现为点了没反应）
      const sel = view.state.selection
      let inside = !sel.empty && pos >= sel.from && pos <= sel.to
      if (sel instanceof CellSelection) {
        // CellSelection 的 from/to 只覆盖首格，必须逐格判定，否则批量操作前选区就被折叠了
        inside = false
        sel.forEachCell((cell, cellPos) => {
          if (pos > cellPos && pos < cellPos + cell.nodeSize) inside = true
        })
      }
      if (!inside) {
        try {
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
        } catch {
          /* 落点不可解析：保持原选区 */
        }
      }
    }
    // 行列可删性按落位后的选区复算：表头不可删/不可上方插入、只剩单列时不可删列
    let meta: ReturnType<typeof findTableSelection> = findTableSelection(view)
    if (!meta) {
      // 选区仍不在表格里（极端落点）：按被点的表格 DOM 反查节点位置，
      // 让复制/格式动作至少作用在右键的那张表上
      try {
        const $p = view.state.doc.resolve(view.posAtDOM(tableEl, 0))
        for (let d = $p.depth; d > 0; d--) {
          if ($p.node(d).type.name !== 'table') continue
          meta = { pos: $p.before(d), row: 0, col: 0, canDeleteRow: false, canDeleteCol: false }
          break
        }
      } catch {
        /* 忽略 */
      }
    }
    const tNode = meta ? view.state.doc.nodeAt(meta.pos) : null
    const colCount = tNode && tNode.childCount > 0 ? tNode.child(0).childCount : 0
    const rowCount = tNode ? tNode.childCount : 0
    const span = pmTableSpan(view.state)
    // 选区含表头时只删数据行；表头不可删、schema 要求至少留一行数据
    const dataRows = span ? span.bottom - Math.max(span.top, 1) : 0
    const rowBatch = span && span.bottom - span.top > 1 ? dataRows : 0
    const colBatch = span && span.right - span.left > 1 ? span.right - span.left : 0
    openTableMenu(
      e.clientX,
      e.clientY,
      {
        canRow: rowBatch > 0 ? dataRows < rowCount - 1 : (meta?.canDeleteRow ?? false),
        canCol: colBatch > 0 ? colBatch < colCount : (meta?.canDeleteCol ?? false),
        rowBatch,
        colBatch,
        canAbove: (meta?.row ?? 0) >= 1,
        // 右键「复制/剪切」：只有存在选中内容（文字选区或单元格多选）才可用
        canCopy: !view.state.selection.empty,
        canCut: !view.state.selection.empty,
        // 第一列禁左移、最后一列禁右移（与删列的边界一致）
        canMoveLeft: !!meta && meta.col > 0,
        canMoveRight: !!meta && colCount > 0 && meta.col < colCount - 1,
        // 行移动边界：表头(0)/首个数据行(1)禁上移；末行禁下移（row0 是表头行）
        canMoveRowUp: !!meta && meta.row >= 2,
        canMoveRowDown: !!meta && meta.row >= 1 && meta.row < rowCount - 1
      },
      { kind: 'pm', view, tablePos: meta?.pos }
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
    // 预览只读：复制仅在有选区时可用（同编辑器的置灰规则）
    const sel = window.getSelection()
    const inPvSel = !!sel && !sel.isCollapsed && !!sel.anchorNode && pvTable.contains(sel.anchorNode)
    openTableMenu(
      e.clientX,
      e.clientY,
      {
        canRow: true,
        canCol: true,
        canAbove: false,
        canCopy: inPvSel,
        canCut: false,
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
    // 右键落在文本选区内才按选区批量（CM 右键不移动光标，选区外按落点单行/单列）
    const main = view.state.selection.main
    const toLineCh = (p: number): { line: number; ch: number } => {
      const l = view.state.doc.lineAt(p)
      return { line: l.number, ch: p - l.from }
    }
    const span =
      !main.empty && pos >= main.from && pos <= main.to
        ? tableSelectionSpan(
            (n) => view.state.doc.line(n).text,
            info,
            toLineCh(main.from),
            toLineCh(main.to)
          )
        : null
    const dataRows = span ? Math.max(0, span.rowTo - Math.max(span.rowFrom, 2) + 1) : 0
    const rowBatch = span && span.rowTo > span.rowFrom ? dataRows : 0
    const colBatch = span && span.colTo > span.colFrom ? span.colTo - span.colFrom + 1 : 0
    openTableMenu(
      e.clientX,
      e.clientY,
      {
        canRow: rowBatch > 0 ? dataRows < info.bodyCount : info.cursorLine > info.startLine + 1,
        canCol: colBatch > 0 ? colBatch < info.colCount : info.colCount > 1,
        rowBatch,
        colBatch,
        canAbove: info.cursorLine > info.startLine + 1,
        canCopy: !main.empty,
        canCut: !main.empty,
        canMoveLeft: info.colIndex > 0,
        canMoveRight: info.colIndex < info.colCount - 1,
        // 行移动边界：表头(0)/分隔行(1)/首个数据行(2)禁上移；末行禁下移
        canMoveRowUp: blockIdx >= 3,
        canMoveRowDown: blockIdx >= 2 && info.cursorLine < info.endLine
      },
      { kind: 'cm', view, info, span }
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
