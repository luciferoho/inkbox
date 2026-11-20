import { TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Fragment, type Node as PMNode, type Schema } from '@milkdown/kit/prose/model'
import type { EditorView as PMView } from '@milkdown/kit/prose/view'
import type { EditorView as CmView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { cellStart, detectTable, joinCells, splitCells } from './table-utils'

/**
 * TSV 粘贴 → 表格（M6 6.4a，Typora 行为）：
 * - 剪贴板 text/plain 含制表符即视为表格数据（Excel/网页表格的纯文本形态）
 * - 表格内：从光标所在格起逐格填充；越出的行加在表尾、越出的列补在右侧；
 *   光标在表头/分隔行时数据从首个数据行开始落（表头不长数据）
 * - 表格外：即显自动建 N×M 表插到当前块后（空段落原地替换）；源码生成归一
 *   管道表文本（前后保证空行分隔）
 * - 单元格内 | 转义为 \|、换行拍平成空格，保证不破坏表格结构
 */

export function parseTsv(text: string): string[][] | null {
  if (!text.includes('\t')) return null
  const rows = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')))
  if (rows.length === 0 || rows[0].length < 2) return null
  return rows
}

/** TSV 行 → 归一形态管道表（首行表头 + 分隔行，无对齐标记） */
export function tsvToPipeTable(rows: string[][]): string {
  const w = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]): string[] => {
    const c = [...r]
    while (c.length < w) c.push('')
    return c
  }
  const lines = [joinCells(pad(rows[0])), joinCells(new Array(w).fill('---'))]
  for (let i = 1; i < rows.length; i++) lines.push(joinCells(pad(rows[i])))
  return lines.join('\n')
}

/* ---------- 即显侧 ---------- */

function cellOf(schema: Schema, name: string, text: string): PMNode {
  const para = schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
  // alignment 必须显式置 null：gfm schema 默认 'left'，序列化会写出 ':---' 对齐
  // 标记，与磁盘上普通 '---' 表格不一致（null = 无对齐 → 序列化为 '---'）
  return schema.nodes[name].create({ alignment: null }, para)
}

function makeRow(proto: PMNode, cells: PMNode[]): PMNode {
  return proto.copy(Fragment.fromArray(cells))
}

/** 重建填充后的表格节点（不改动原节点；扩行加在末尾、扩列补在右侧） */
function fillTable(table: PMNode, rows: string[][], r0: number, c0: number): PMNode {
  const schema = table.type.schema
  const rowCount = Math.max(table.childCount, r0 + rows.length)
  const colCount = Math.max(
    table.child(0).childCount,
    ...rows.map((r) => c0 + r.length)
  )
  // 单元格矩阵（引用原单元格，落点换成新内容；最后一行为扩行原型）
  const grid: PMNode[][] = []
  for (let r = 0; r < rowCount; r++) {
    const src = table.child(Math.min(r, table.childCount - 1))
    const line: PMNode[] = []
    for (let c = 0; c < colCount; c++) {
      line.push(c < src.childCount ? src.child(c) : cellOf(schema, r === 0 ? 'table_header' : 'table_cell', ''))
    }
    grid.push(line)
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      grid[r0 + i][c0 + j] = cellOf(schema, r0 + i === 0 ? 'table_header' : 'table_cell', rows[i][j])
    }
  }
  const out = grid.map((line, r) => makeRow(table.child(Math.min(r, table.childCount - 1)), line))
  return table.copy(Fragment.fromArray(out))
}

/** 光标落表格 (row,col) 格内文本起点 */
function focusCell(tr: Transaction, tablePos: number, row: number, col: number): void {
  const t = tr.doc.nodeAt(tablePos)
  if (!t) return
  let p = tablePos + 1
  for (let i = 0; i < row; i++) p += t.child(i).nodeSize
  p += 1 // 进行
  for (let j = 0; j < col; j++) p += t.child(row).child(j).nodeSize
  p += 2 // 进格 + 进段
  try {
    tr.setSelection(TextSelection.near(tr.doc.resolve(p), 1))
  } catch {
    /* 位置异常时保持原选区 */
  }
}

export function pmPasteTsv(view: PMView, text: string): boolean {
  const rows = parseTsv(text)
  if (!rows) return false
  const { state } = view
  const { $from } = state.selection
  const schema = state.schema

  // 光标所在表格与单元格坐标（不在表格内 → 建表插入）
  let tableDepth = -1
  let cellDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d)
    if (cellDepth < 0 && (n.type.name === 'table_cell' || n.type.name === 'table_header'))
      cellDepth = d
    if (n.type.name === 'table') {
      tableDepth = d
      break
    }
  }
  if (tableDepth < 0) {
    // 表格外：建表插到当前块后（当前块为空段落则原地替换；空文档插在 0）
    const table = (() => {
      const w = Math.max(...rows.map((r) => r.length))
      const pad = (r: string[]): string[] => {
        const c = [...r]
        while (c.length < w) c.push('')
        return c
      }
      const mkRow = (cells: string[], header: boolean): PMNode =>
        header
          ? // 首行必须是 table_header_row：table 内容为 "table_header_row table_row+"，
            // 用 table_row 装表头单元格会建出非法节点，随后加行列全抛 contentMatchAt（P13）
            schema.nodes.table_header_row.create(
              null,
              pad(cells).map((c) => cellOf(schema, 'table_header', c))
            )
          : schema.nodes.table_row.create(
              null,
              pad(cells).map((c) => cellOf(schema, 'table_cell', c))
            )
      // cellOf 已把 alignment 置 null，序列化保持 '---' 分隔行
      const out = [mkRow(rows[0], true)]
      for (let i = 1; i < rows.length; i++) out.push(mkRow(rows[i], false))
      return schema.nodes.table.create(null, out)
    })()
    const tr = state.tr
    let tablePos: number
    if ($from.depth === 0) {
      tr.insert(0, table)
      tablePos = 0
    } else if ($from.node(1).type.name === 'paragraph' && !$from.node(1).textContent.trim()) {
      tablePos = $from.before(1)
      tr.replaceWith(tablePos, $from.after(1), table)
    } else {
      tablePos = $from.after(1)
      tr.insert(tablePos, table)
    }
    focusCell(tr, tablePos, Math.min(rows.length - 1, 0), 0)
    view.dispatch(tr.scrollIntoView())
    return true
  }

  // 表格内：从光标格起填充（PM 无分隔行，表头行粘贴即填表头格）
  const table = $from.node(tableDepth)
  const tablePos = $from.before(tableDepth)
  const r0 = $from.index(cellDepth - 1)
  const c0 = $from.index(cellDepth)
  const tr = state.tr
  tr.replaceWith(tablePos, tablePos + table.nodeSize, fillTable(table, rows, r0, c0))
  const nb = tr.doc.nodeAt(tablePos)
  if (nb) {
    const lr = Math.min(r0 + rows.length - 1, nb.childCount - 1)
    const lc = Math.min(c0 + rows[0].length - 1, nb.child(lr).childCount - 1)
    focusCell(tr, tablePos, lr, lc)
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

/* ---------- 源码侧 ---------- */

export function cmPasteTsv(view: CmView, text: string): boolean {
  const rows = parseTsv(text)
  if (!rows) return false
  const { state } = view
  const head = state.selection.main.head
  const headLine = state.doc.lineAt(head)
  // 围栏代码/前置元数据/HTML 块内不接管（原样文本粘贴）
  let nd: SyntaxNode | null = syntaxTree(state).resolveInner(head, -1)
  while (nd) {
    if (nd.name === 'FencedCode' || nd.name === 'FrontMatter' || nd.name === 'HTMLBlock') return false
    nd = nd.parent
  }
  const info = detectTable(
    state.doc.lines,
    (n) => state.doc.line(n).text,
    headLine.number,
    head - headLine.from
  )

  if (info) {
    // 表格内：整块重写为填充后的网格（表头/分隔行上粘贴从首个数据行落）
    const blockFrom = state.doc.line(info.startLine).from
    const blockTo = state.doc.line(info.endLine).to
    const lines: string[] = []
    for (let n = info.startLine; n <= info.endLine; n++) lines.push(state.doc.line(n).text)
    const grid = lines.map((l) => splitCells(l))
    const r0 = Math.max(2, info.cursorLine - info.startLine)
    const c0 = info.colIndex
    const rowCount = Math.max(grid.length, r0 + rows.length)
    const colCount = Math.max(
      info.colCount,
      ...grid.map((g) => g.length),
      ...rows.map((r) => c0 + r.length)
    )
    while (grid.length < rowCount) grid.push([])
    for (let r = 0; r < rowCount; r++) {
      const isSep = r === 1
      while (grid[r].length < colCount) grid[r].push(isSep ? '---' : '')
    }
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < rows[i].length; j++) {
        grid[r0 + i][c0 + j] = rows[i][j]
      }
    }
    const out = grid.map((cells) => joinCells(cells))
    const lastRow = Math.min(r0 + rows.length - 1, grid.length - 1)
    view.dispatch({
      changes: { from: blockFrom, to: blockTo, insert: out.join('\n') },
      selection: {
        anchor:
          blockFrom +
          out.slice(0, lastRow).reduce((acc, text) => acc + text.length + 1, 0) +
          cellStart(out[lastRow], Math.min(c0 + rows[0].length - 1, info.colCount - 1))
      },
      scrollIntoView: true
    })
    return true
  }

  // 表格外：生成管道表插入（前后保证空行分隔）
  const insert = tsvToPipeTable(rows)
  const { from, to } = state.selection.main
  const beforeChar = from > 0 ? state.doc.sliceString(from - 1, from) : '\n'
  const afterChar = to < state.doc.length ? state.doc.sliceString(to, to + 1) : '\n'
  const blankAbove = from >= 2 && state.doc.sliceString(from - 2, from) === '\n\n'
  const lead = beforeChar !== '\n' ? '\n\n' : blankAbove ? '' : '\n'
  const tail = afterChar === '\n' ? '\n' : '\n\n'
  const full = lead + insert + tail
  view.dispatch({
    changes: { from, to, insert: full },
    selection: { anchor: from + full.length },
    scrollIntoView: true
  })
  return true
}
