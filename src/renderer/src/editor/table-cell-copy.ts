/**
 * 表格单元格多选 → 剪贴板内容（WPS/Excel 语义）。
 *
 * 复制选中的单元格区域时输出 TSV（text/plain）+ HTML 表格（text/html）：
 * - TSV 供本应用（以及 Excel/WPS）按「逐格」粘贴——配合 tsv-paste 的填充逻辑，
 *   粘到别的表格里就是从落点格开始的区域填充，而不是把所有文字塞进一个格子
 * - HTML 供富文本目标（Word/WPS 文字）粘成表格
 *
 * 只处理 CellSelection（整格多选）；单元格内的文字选区仍走浏览器默认复制。
 */
import { CellSelection, selectedRect } from '@milkdown/kit/prose/tables'
import { TextSelection, type EditorState } from '@milkdown/kit/prose/state'

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 单元格文本 → 单格纯文本：制表符/换行会破坏 TSV 结构，统一拍平成空格 */
const flat = (s: string): string => s.replace(/[\t\r\n]+/g, ' ').trim()

/** 选中区域 → { tsv, html }；不是单元格多选时返回 null */
export function cellSelectionClipboard(state: EditorState): { tsv: string; html: string } | null {
  if (!(state.selection instanceof CellSelection)) return null
  const rect = selectedRect(state)
  const table = state.doc.nodeAt(rect.tableStart - 1)
  if (!table) return null
  const rows: string[][] = []
  for (let r = rect.top; r < rect.bottom; r++) {
    const row = table.child(r)
    const cells: string[] = []
    for (let c = rect.left; c < rect.right; c++) {
      cells.push(flat(row.child(c)?.textContent ?? ''))
    }
    rows.push(cells)
  }
  if (!rows.length || !rows[0].length) return null
  const tsv = rows.map((cells) => cells.join('\t')).join('\n')
  const html =
    '<table>' +
    rows.map((cells) => '<tr>' + cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>').join('') +
    '</table>'
  return { tsv, html }
}

/**
 * 右键「复制/剪切」的内容来源（不依赖 DOM 选区）。
 *
 * 不能用 document.execCommand('copy')：单元格多选时 PM 的 DOM 选区是折叠的，
 * 命令直接返回 false、剪贴板保持上一次的旧内容——粘贴出来就是"乱七八糟"的东西。
 * 这里按 PM 状态取内容，由调用方用 clipboard API 直写。
 */
export function pmClipboardData(state: EditorState): { text: string; html?: string } | null {
  const cell = cellSelectionClipboard(state)
  if (cell) return { text: cell.tsv, html: cell.html }
  if (state.selection instanceof TextSelection && !state.selection.empty) {
    const text = state.doc.textBetween(state.selection.from, state.selection.to, '\n')
    if (text.trim()) return { text }
  }
  return null
}
