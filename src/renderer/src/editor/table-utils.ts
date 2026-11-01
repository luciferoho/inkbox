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
  | { kind: 'row-up' }
  | { kind: 'row-down' }
  | { kind: 'col-left' }
  | { kind: 'col-right' }
  | { kind: 'col-delete' }
  | { kind: 'col-move-left' }
  | { kind: 'col-move-right' }
  | { kind: 'align'; how: 'left' | 'center' | 'right' | 'none' }
  | { kind: 'format-table' }
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
  // 补齐只到 colCount：最右列「右侧插入」时 at === colCount，若补到 at+1 会
  // 先垫出一个多余空列、再插入一列 → 一次操作冒出两列
  const mapCells = (at: number, del: boolean, filler: string): void => {
    for (let i = 0; i < lines.length; i++) {
      const cells = splitCells(lines[i])
      while (cells.length < colCount) cells.push(i === 1 ? '---' : '')
      if (del) cells.splice(at, 1)
      else cells.splice(at, 0, i === 1 ? '---' : filler)
      lines[i] = joinCells(cells)
    }
  }

  switch (op.kind) {
    case 'row-above': {
      // 表头/分隔行之上不可插入（菜单已禁用；直接调用也按不可执行处理）
      if (idx <= 1) return null
      lines.splice(idx, 0, emptyRow())
      return { lines, cursorLine: idx, cursorCol: Math.min(info.colIndex, colCount - 1) }
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
    case 'row-up': {
      // 与上一数据行整行交换；表头(0)/分隔行(1)不可动，首个数据行(2)上移 = 顶到
      // 分隔行，同样不可执行（Typora 同语义，菜单按此禁用）
      if (idx < 3 || idx >= lines.length) return null
      const tmp = lines[idx - 1]
      lines[idx - 1] = lines[idx]
      lines[idx] = tmp
      return { lines, cursorLine: idx - 1, cursorCol: Math.min(info.colIndex, colCount - 1) }
    }
    case 'row-down': {
      if (idx < 2 || idx >= lines.length - 1) return null
      const tmp = lines[idx + 1]
      lines[idx + 1] = lines[idx]
      lines[idx] = tmp
      return { lines, cursorLine: idx + 1, cursorCol: Math.min(info.colIndex, colCount - 1) }
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
    case 'col-move-left':
    case 'col-move-right': {
      // 整列（含分隔行对齐标记）与相邻列交换；到边界返回不可执行
      const to = op.kind === 'col-move-left' ? info.colIndex - 1 : info.colIndex + 1
      if (to < 0 || to >= colCount) return null
      for (let i = 0; i < lines.length; i++) {
        const cells = splitCells(lines[i])
        while (cells.length < colCount) cells.push(i === 1 ? '---' : '')
        const tmp = cells[info.colIndex] ?? ''
        cells[info.colIndex] = cells[to] ?? (i === 1 ? '---' : '')
        cells[to] = tmp
        lines[i] = joinCells(cells)
      }
      return { lines, cursorLine: idx, cursorCol: to }
    }
    case 'format-table': {
      // Typora「格式化表格源码」同语义：内容不变，各列按最大显示宽（CJK/全角
      // 记 2）补空格对齐；分隔行保留对齐标记并补齐到列宽
      const cellRows = lines.map((l) => splitCells(l))
      const colN = Math.max(colCount, ...cellRows.map((cs) => cs.length), 1)
      const widths: number[] = []
      for (let c = 0; c < colN; c++) {
        let w = 3
        for (let i = 0; i < cellRows.length; i++) {
          if (i === 1) continue // 分隔行不参与测宽
          w = Math.max(w, dispWidth(cellRows[i]?.[c] ?? ''))
        }
        widths.push(w)
      }
      const out = cellRows.map((cs, i) => {
        const filled: string[] = []
        for (let c = 0; c < colN; c++) {
          const raw = cs[c] ?? (i === 1 ? '---' : '')
          if (i === 1) {
            const m = /^(:?)(-+)\??(:?)$/.exec(raw.trim()) ?? /^(:?)()(:?)$/.exec('---')
            const lead = m?.[1] ?? ''
            const trail = m?.[3] ?? ''
            const dashes = Math.max(1, widths[c] - lead.length - trail.length)
            filled.push((lead + '-'.repeat(dashes) + trail).padEnd(widths[c], '-'))
          } else {
            filled.push(raw + ' '.repeat(Math.max(0, widths[c] - dispWidth(raw))))
          }
        }
        return `| ${filled.join(' | ')} |`
      })
      lines.splice(0, lines.length, ...out)
      return { lines, cursorLine: idx, cursorCol: Math.min(info.colIndex, colN - 1) }
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

/** 分隔行单元格归一：至少 3 个连字符并保留对齐标记（`:---` / `:---:` / `---:`）。
 *  GFM 要求分隔行每格 ≥3 个 `-`——少于 3 个时该行不是分隔行，整张表退化为
 *  普通段落（milkdown 的 markdown-table 序列化器会按内容宽度缩到 1-2 个，
 *  存盘后预览与其它编辑器直接渲染失败） */
function normalizeSepCell(raw: string): string {
  const t = raw.trim()
  const lead = t.startsWith(':') ? ':' : ''
  const trail = t.endsWith(':') ? ':' : ''
  const inner = t.replace(/^:/, '').replace(/:$/, '')
  const dashes = Math.max(3, inner.replace(/[^:-]/g, '').length)
  return lead + '-'.repeat(dashes) + trail
}

/** 即显写回前归一化表格源码：markdown-table 会把整表按显示宽度重排
 *  （补空格、分隔行缩到 1-2 个连字符）。这里把表格块压回紧凑形态
 *  `| a | b |`、分隔行统一 ≥3 连字符；已规范的表格输出逐字节不变。
 *  跳过代码围栏内的 | 行。 */
export function normalizeTables(md: string): string {
  const lines = md.split('\n')
  const isRow = (l: string): boolean => /^[ \t]*\|/.test(l)
  const isSep = (l: string): boolean =>
    isRow(l) && splitCells(l).every((c) => /^:?-{1,}:?$/.test(c))
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const fm = /^[ \t]*(`{3,}|~{3,})/.exec(lines[i])
    if (fm) {
      if (fence === null) fence = fm[1].slice(0, 1).repeat(3)
      else if (lines[i].trimStart().startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    // 表格块起始：本行是 | 行且下一行是分隔行
    if (!isRow(lines[i]) || i + 1 >= lines.length || !isSep(lines[i + 1])) continue
    const indent = /^[ \t]*/.exec(lines[i])![0]
    const start = i
    let end = i + 1
    while (end + 1 < lines.length && isRow(lines[end + 1])) end++
    for (let k = start; k <= end; k++) {
      const cells = splitCells(lines[k])
      const body =
        k === start + 1
          ? cells.map(normalizeSepCell)
          : cells.map((c) => c)
      lines[k] = indent + `| ${body.join(' | ')} |`
    }
    i = end
  }
  return lines.join('\n')
}

const WIDE_CHAR_RE =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F\u2190-\u21FF\u{1F300}-\u{1FAFF}]/u

/** 显示宽度：CJK/全角/常用 emoji 记 2，其余记 1（源码列对齐用）。
 *  星形区（emoji）必须用 \u{} + u 标志——裸 \u1F300 会被切成 \u1F30+字面量，
 *  产生覆盖 ASCII 的杂散范围（A1 都算宽字符，列对齐全错） */
function dispWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    w += WIDE_CHAR_RE.test(ch) ? 2 : 1
  }
  return w
}
