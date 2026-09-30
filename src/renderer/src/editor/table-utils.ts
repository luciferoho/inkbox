/**
 * Markdown 表格解析与结构操作（表格悬浮工具栏的数据层）。
 * 识别"行首为 | 的连续块，第二行为分隔行"的松散表格；单元格内的 \| 视为
 * 转义竖线。全部操作是纯文本变换，SourceEditor 用单事务应用，Ctrl+Z 可撤销。
 */

export interface TableInfo {
  /** 块起始行（1 基） */
  startLine: number
  /** 块结束行（1 基，含） */
  endLine: number
  /** 光标所在行（1 基） */
  cursorLine: number
  /** 光标所在列（0 基，按未转义 | 分隔） */
  colIndex: number
  colCount: number
  /** 数据行数（不含表头与分隔行） */
  bodyCount: number
}

export type TableOp =
  | { kind: 'row-above' }
  | { kind: 'row-below' }
  | { kind: 'row-delete' }
  | { kind: 'col-left' }
  | { kind: 'col-right' }
  | { kind: 'col-delete' }
  | { kind: 'align'; how: 'left' | 'center' | 'right' | 'none' }
  | { kind: 'table-delete' }

export interface TableEdit {
  /** 操作后的块内容；空数组 = 整块删除 */
  lines: string[]
  /** 操作后光标应落的块内行（0 基） */
  cursorLine: number
  /** 光标应落的单元格（0 基） */
  cursorCol: number
}

const FENCE_OPEN = /^(```+|~~~+)/
const SEP_CELL = /^\s*:?-+:?\s*$/

/** 行内容 → 单元格（去首尾管道，按未转义 | 切分并 trim） */
export function splitCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map((c) => c.trim())
}

/** 单元格 → 行内容 */
export function joinCells(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

/** 行内第 col 个单元格的起始偏移（左管道后的"| "之后，夹取行尾）。
 *  单元格 c 的左边界是第 c 根管道（行首管道即第 0 根） */
export function cellStart(lineText: string, col: number): number {
  const pipes: number[] = []
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === '|' && lineText[i - 1] !== '\\') pipes.push(i)
  }
  if (pipes.length === 0) return lineText.length
  const idx = Math.min(Math.max(col, 0), pipes.length - 1)
  return Math.min(lineText.length, pipes[idx] + 2)
}

/** 光标处表格检测；代码围栏内的 | 行不算表格 */
export function detectTable(
  lineCount: number,
  lineAt: (n: number) => string,
  cursorLine: number,
  posInLine: number
): TableInfo | null {
  const isRow = (n: number): boolean => /^\s*\|/.test(lineAt(n))
  if (cursorLine < 1 || cursorLine > lineCount || !isRow(cursorLine)) return null
  let start = cursorLine
  while (start > 1 && isRow(start - 1)) start--
  let end = cursorLine
  while (end < lineCount && isRow(end + 1)) end++
  if (end - start < 1) return null // 至少要 表头+分隔 两行
  // 围栏状态扫描（到块首为止）：仍未闭合 = 在代码块内
  let fence: string | null = null
  for (let n = 1; n < start; n++) {
    const t = lineAt(n)
    const m = FENCE_OPEN.exec(t)
    if (m) {
      if (fence === null) fence = m[1].slice(0, 3)
      else if (t.startsWith(fence)) fence = null
    }
  }
  if (fence !== null) return null
  const sep = lineAt(start + 1)
  const sepCells = splitCells(sep)
  if (sepCells.length < 1 || !sepCells.every((c) => SEP_CELL.test(c))) return null
  const colCount = Math.max(1, splitCells(lineAt(start)).length)
  const before = lineAt(cursorLine).slice(0, posInLine)
  // 行首管道是边界不是分隔符：pos 前的管道数减 1 才是所在单元格
  const pipesBefore = (before.match(/(?<!\\)\|/g) || []).length
  const colIndex = Math.min(colCount - 1, Math.max(0, pipesBefore - 1))
  return { startLine: start, endLine: end, cursorLine, colIndex, colCount, bodyCount: end - start - 1 }
}

/** 对表格块应用结构操作；不可执行（如删到无行列）返回 null */
export function applyTableOp(
  lines: string[],
  info: TableInfo,
  op: TableOp
): TableEdit | null {
  const idx = info.cursorLine - info.startLine // 块内 0 基行；1 = 分隔行
  const colCount = info.colCount
  const emptyRow = (): string => joinCells(new Array(colCount).fill(''))

  // 每行在第 at 个位置插入/删除一个单元格
  const mapCells = (at: number, del: boolean, filler: string): void => {
    for (let i = 0; i < lines.length; i++) {
      const cells = splitCells(lines[i])
      while (cells.length < Math.max(colCount, at + 1)) cells.push(i === 1 ? '---' : '')
      if (del) cells.splice(at, 1)
      else cells.splice(at, 0, i === 1 ? '---' : filler)
      lines[i] = joinCells(cells)
    }
  }

  switch (op.kind) {
    case 'row-above': {
      const at = idx <= 1 ? 2 : idx
      lines.splice(at, 0, emptyRow())
      return { lines, cursorLine: at, cursorCol: Math.min(info.colIndex, colCount - 1) }
    }
    case 'row-below': {
      const at = idx <= 1 ? 2 : idx + 1
      lines.splice(at, 0, emptyRow())
      return { lines, cursorLine: at, cursorCol: Math.min(info.colIndex, colCount - 1) }
    }
    case 'row-delete': {
      if (idx <= 1) return null // 表头/分隔行不可删
      lines.splice(idx, 1)
      const cl = Math.min(idx, lines.length - 1)
      return { lines, cursorLine: cl, cursorCol: Math.min(info.colIndex, colCount - 1) }
    }
    case 'col-left': {
      mapCells(info.colIndex, false, '')
      return { lines, cursorLine: idx, cursorCol: info.colIndex }
    }
    case 'col-right': {
      mapCells(info.colIndex + 1, false, '')
      return { lines, cursorLine: idx, cursorCol: info.colIndex + 1 }
    }
    case 'col-delete': {
      if (colCount <= 1) return null
      mapCells(info.colIndex, true, '')
      return { lines, cursorLine: idx, cursorCol: Math.max(0, info.colIndex - 1) }
    }
    case 'align': {
      const cells = splitCells(lines[1])
      while (cells.length < colCount) cells.push('---')
      cells[info.colIndex] =
        op.how === 'left' ? ':---' : op.how === 'center' ? ':---:' : op.how === 'right' ? '---:' : '---'
      lines[1] = joinCells(cells)
      return { lines, cursorLine: idx, cursorCol: info.colIndex }
    }
    case 'table-delete':
      return { lines: [], cursorLine: 0, cursorCol: 0 }
  }
}
