/**
 * 表格列宽（ROADMAP 2.2）：即显/预览拖拽列边界调宽，双管线共享会话级列宽记忆。
 *
 * 语法层持久化的取舍（设计决策）：HTML 注释/分隔行扩展都会污染 markdown 的
 * 可移植性（其他渲染器显示杂讯或判定表格失效），与 Typora 行为对齐——列宽是
 * 视图态而非文档态：本模块以「表头单元格文本」为键做会话内记忆，文档不加任何
 * 标记；跨会话不保留。表头相同的表格（预览/即显/切签重渲染）自动恢复列宽。
 *
 * 两管线的落地方式不同：
 * - 预览：普通 HTML，直接注入 td/th 内联宽度（applyColWidths）；
 * - 即显：ProseMirror 管理表格 DOM，任何外部属性/结构写入都会被 DOM 观察器
 *   当成文档变更触发事务、重绘又抹掉写入，形成死循环（实测会卡死渲染进程）。
 *   因此即显侧走 PM 装饰器（createTableWidthsPlugin），列宽由 PM 自己渲染。
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView as PmView } from '@milkdown/kit/prose/view'

const MAX_ENTRIES = 200

/** 列宽记忆：表键 → 像素宽度数组（文档不加标记，视图态） */
const store = new Map<string, number[]>()

/** 表格唯一键：标签 + 文档内表格序号 + 表头文本。
 *  只用表头文本会让同名表头的不同表格互相串列宽（实测问题），
 *  序号保证同一文档内各表独立；标签隔离不同文档。 */
export function tableKey(tabId: number | string, index: number, header: string): string {
  return `${tabId}\u0002${index}\u0002${header}`
}

/** 列宽记忆变更订阅（双栏两块面板各自动作后互相同步） */
const listeners = new Set<(key: string) => void>()

export function onColWidthsChanged(fn: (key: string) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function headerKeyOf(table: HTMLTableElement): string {
  const first = table.rows[0]
  if (!first) return ''
  return Array.from(first.cells)
    .map((c) => c.textContent?.trim() ?? '')
    .join('\u0001')
}

export function getColWidths(key: string): number[] | null {
  return store.get(key) ?? null
}

/** 写回记忆；silent = 调用方自己负责重绘（即显侧拖拽每帧都会写，避免双份刷新） */
export function setColWidths(key: string, widths: number[], silent = false): void {
  store.delete(key)
  store.set(key, widths)
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  if (!silent) for (const fn of listeners) fn(key)
}

/** 清除某表的列宽记忆（右键「自适应宽度」） */
export function clearColWidths(key: string): void {
  if (!store.delete(key)) return
  for (const fn of listeners) fn(key)
}

/* ---------- 预览侧（普通 HTML，内联宽度） ---------- */

/** 表格当前各列宽：优先读表头单元格的注入宽度，否则按 DOM 实测 */
export function widthsFromDom(table: HTMLTableElement): number[] | null {
  const first = table.rows[0]
  if (!first) return null
  return Array.from(first.cells).map((c) => {
    const w = parseFloat((c as HTMLElement).style.width)
    return Number.isFinite(w) && w > 0 ? Math.round(w) : Math.round(c.getBoundingClientRect().width)
  })
}

/** 把列宽注入预览表格：fixed 布局 + 列内所有单元格内联 px 宽度。
 *  表格总宽 = 列宽之和（不再按容器百分比压缩），窄容器由外层横向滚动承接。
 *  逐列取整的误差由最后一列吸收：否则多列各自四舍五入会累积出几像素，
 *  下一次拖拽再读回这些宽度，表格就会一路「长胖」并顶破内容列。 */
export function applyColWidths(table: HTMLTableElement, widths: number[]): void {
  const first = table.rows[0]
  if (!first) return
  const colCount = first.cells.length
  if (colCount === 0 || widths.length < colCount) return
  const total = Math.round(widths.slice(0, colCount).reduce((a, b) => a + b, 0))
  if (total <= 0) return
  const rounded = widths.slice(0, colCount).map((w) => Math.max(1, Math.round(w)))
  const diff = total - rounded.reduce((a, b) => a + b, 0)
  rounded[colCount - 1] = Math.max(1, rounded[colCount - 1] + diff)
  table.style.tableLayout = 'fixed'
  table.style.width = `${Math.round(rounded.reduce((a, b) => a + b, 0))}px`
  table.style.minWidth = '0'
  table.style.maxWidth = 'none'
  for (const row of Array.from(table.rows)) {
    for (let i = 0; i < colCount; i++) {
      const cell = row.cells[i] as HTMLElement | undefined
      if (!cell) continue
      const px = `${rounded[i]}px`
      if (cell.style.width !== px) cell.style.width = px
    }
  }
}

/** 去除注入的列宽（恢复自适应布局） */
export function resetTableWidth(table: HTMLTableElement): void {
  table.style.tableLayout = ''
  table.style.width = ''
  table.style.minWidth = ''
  table.style.maxWidth = ''
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) (cell as HTMLElement).style.width = ''
  }
}

/** 表格是否已注入列宽（表头首格带内联宽度即视为已注入） */
export function hasColWidths(table: HTMLTableElement): boolean {
  const c = table.rows[0]?.cells[0] as HTMLElement | undefined
  return !!c?.style.width
}

/** 列边界命中结果：列号 + 边界线的视口 x（高亮线与拖拽宽度用同一坐标） */
export interface ColBoundaryHit {
  /** 要调整的列号（0 基；内部边界归属左侧列） */
  col: number
  /** 边界线（分割线）的视口 x 坐标 */
  edgeX: number
}

/** 列边界命中检测：x 距某列边界 ≤ tol px 时返回列号与边界坐标，否则 null。
 *  只认内部边界（归属左侧列）与表格右缘（归属最后一列）：
 *  表格左缘不可拖——首列左侧没有「两列之间」的分割线，拖它只会让整表平移错觉。 */
export function hitColumnBoundaryAt(table: HTMLTableElement, x: number, tol = 5): ColBoundaryHit | null {
  const first = table.rows[0]
  if (!first || first.cells.length < 1) return null
  const cells = Array.from(first.cells)
  // 内部边界：第 i 列左缘 = 第 i-1 与 i 列之间 → 调整第 i-1 列
  for (let i = 1; i < cells.length; i++) {
    const left = cells[i].getBoundingClientRect().left
    if (Math.abs(x - left) <= tol) return { col: i - 1, edgeX: left }
  }
  // 表格右缘：调整最后一列（可通过收窄最后一列把表格缩回内容区）
  const right = cells[cells.length - 1].getBoundingClientRect().right
  if (Math.abs(x - right) <= tol) return { col: cells.length - 1, edgeX: right }
  return null
}

/* ---------- 列边界悬浮反馈：高亮分割线 + col-resize 光标 ----------
 *  悬浮即反馈（不必先按下）。光标不能挂在宿主上：即显正文 .luci-prose 有
 *  cursor:text、预览单元格有各自的 cursor，逐元素 cursor 会被覆盖，只有
 *  body 级 !important 规则（base.css）才稳定；高亮线是 body 层 fixed 覆盖，
 *  不碰 PM 管理的表格 DOM（外部样式写入会触发 DOM 观察器 → 事务 → 死循环）。 */

let boundaryHint: HTMLDivElement | null = null
let resizing = false

function setBoundaryCursor(on: boolean): void {
  // 直接以 DOM 现状为准（不缓存布尔）：组件卸载/模式切换/HMR 都可能在我们
  // 不知情时改掉 body 类，缓存值与实际失同步会出现「光标有/hint 没有」的错位
  if (document.body.classList.contains('inkbox-col-hover') === on) return
  document.body.classList.toggle('inkbox-col-hover', on)
}

/** 显示边界反馈：edgeX 处画一条高亮线（纵向截到 clip/表格范围内）+ 全局列宽光标 */
export function showColBoundaryFeedback(
  table: HTMLTableElement,
  edgeX: number,
  clip?: { top: number; bottom: number } | null
): void {
  setBoundaryCursor(true)
  const rect = table.getBoundingClientRect()
  const top = Math.max(rect.top, clip?.top ?? 0)
  const bottom = Math.min(rect.bottom, clip?.bottom ?? window.innerHeight)
  if (bottom - top < 2) {
    if (boundaryHint) boundaryHint.style.display = 'none'
    return
  }
  if (!boundaryHint) {
    // 开发态 HMR 会重置本模块状态，先接管已存在的高亮线，避免叠出第二条
    const existing = document.querySelector<HTMLDivElement>('.inkbox-col-boundary-hint')
    if (existing) boundaryHint = existing
    else {
      boundaryHint = document.createElement('div')
      boundaryHint.className = 'inkbox-col-boundary-hint'
      document.body.appendChild(boundaryHint)
    }
  }
  boundaryHint.style.left = `${Math.round(edgeX) - 1}px`
  boundaryHint.style.top = `${Math.round(top)}px`
  boundaryHint.style.height = `${Math.round(bottom - top)}px`
  boundaryHint.style.display = ''
}

/** 收起边界反馈（光标 + 高亮线） */
export function hideColBoundaryFeedback(): void {
  setBoundaryCursor(false)
  if (boundaryHint) boundaryHint.style.display = 'none'
}

/** 是否正处于列宽拖拽（悬浮反馈在拖拽期间让位，避免与拖拽跟随互相覆盖） */
export function isColResizing(): boolean {
  return resizing
}

/** 列宽拖拽态：全局光标/禁用选择（拖拽中鼠标可能离开表格，逐元素 cursor 会被覆盖） */
export function beginColResize(): void {
  resizing = true
  document.body.classList.add('inkbox-col-resizing')
}

export function endColResize(): void {
  resizing = false
  document.body.classList.remove('inkbox-col-resizing')
}

/** 起始列宽归一：让列宽之和等于表格当前渲染宽度。
 *  自适应布局（width:max-content / min-width:100%）切到 fixed 布局时，
 *  若列宽和与表格实宽不一致，会先跳一下再跟手（实测「自适应后再拖会回弹」） */
export function normalizeWidthsToTable(table: HTMLTableElement, widths: number[]): number[] {
  const sum = widths.reduce((a, b) => a + b, 0)
  const w = table.getBoundingClientRect().width
  if (sum <= 0 || w <= 0 || Math.abs(sum - w) < 1) return widths
  return widths.map((x) => (x * w) / sum)
}

/** 拖拽可用的总宽上限（只用于表格右缘 = 最后一列右边界）：
 *  正文内容列宽 = 表格滚动外壳父级（.luci-prose / .md-preview）的内容盒宽度。
 *  不能读外壳自身的 clientWidth——外壳宽度被列宽装饰设成表格总宽，会随拖动一起变。
 *  表格本来就比内容列宽时按现有总宽兜底（只限制继续变宽，不强制回缩）。
 *  内部列边界不做总宽限制：默认表格就有 min-width:100%，若也按内容宽封顶，
 *  全宽表格的内部列将永远拖不动。 */
export function colDragMaxTotal(table: HTMLTableElement, startTotal: number): number {
  const wrap = table.parentElement
  const host = wrap?.parentElement
  let avail = 0
  if (host) {
    const cs = getComputedStyle(host)
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    avail = host.clientWidth - pad
  }
  if (!(avail > 0)) avail = wrap?.clientWidth ?? 0
  return Math.max(startTotal, avail > 0 ? avail : startTotal)
}

/** 拖一次的单列宽度：单列最小 24px；总宽不超过 maxTotal。
 *  返回的数组用于布局，调用方再用 widths[col] 反推边界线位置（线随实际宽度停住）。 */
export function resizeWidths(startWidths: number[], col: number, dx: number, maxTotal: number): number[] {
  const startTotal = startWidths.reduce((a, b) => a + b, 0)
  const room = maxTotal - (startTotal - startWidths[col])
  const upper = Math.max(24, Math.floor(room))
  const next = [...startWidths]
  next[col] = Math.min(Math.max(24, Math.round(startWidths[col] + dx)), upper)
  return next
}

/**
 * 预览侧列宽拖拽：按下命中列边界 → 立即进入拖拽态（阻止文本选中 + 全局列宽光标），
 * 拖动超过阈值才写入列宽（单击不改布局），松手回调最终列宽。
 * 拖拽期间边界高亮线跟随指针（与悬浮同一套反馈）。clip = 可视裁剪范围（滚动容器）。
 * 返回 true 表示已接管该按下。
 */
export function dragColumnWidth(
  table: HTMLTableElement,
  down: MouseEvent,
  onCommit: (widths: number[]) => void,
  clip?: { top: number; bottom: number } | null
): boolean {
  const hit = hitColumnBoundaryAt(table, down.clientX)
  if (!hit) return false
  const col = hit.col
  const measured = widthsFromDom(table)
  if (!measured) return false
  // 边界按下即视为拖拽起点：阻止默认行为，避免拖动过程选中表格文字
  down.preventDefault()
  const startWidths = normalizeWidthsToTable(table, measured)
  const startTotal = startWidths.reduce((a, b) => a + b, 0)
  const cells = table.rows[0].cells
  // 只有表格右缘（最后一列右边界）受内容列宽上限约束
  const maxTotal = col === cells.length - 1 ? colDragMaxTotal(table, startTotal) : Number.POSITIVE_INFINITY
  const startX = down.clientX
  beginColResize()
  let active = false
  let latest = startWidths

  const onMove = (e: MouseEvent): void => {
    // 拖拽全程禁掉默认行为：preventDefault 掉 mousemove 的选区扩展
    // （mousedown 已拦过一次，这里兜住边界误差/组合手势的漏网情形）
    e.preventDefault()
    const dx = e.clientX - startX
    if (!active) {
      if (Math.abs(dx) < 3) return // 阈值内视为点击，不改布局
      active = true
      // 拖动前先落 fixed：避免首帧按自动布局重排造成跳动
      applyColWidths(table, startWidths)
    }
    latest = resizeWidths(startWidths, col, dx, maxTotal)
    applyColWidths(table, latest)
    // 内容/CSS 最小宽会挡住「更窄」：把实际渲染宽度写回，否则存档是 24、渲染是 57，
    // 表格会比外壳(总宽=存档和)宽出一条，白出一根横向滚动条
    const actual = table.rows[0].cells[col]?.getBoundingClientRect().width
    if (actual && actual - latest[col] >= 1) {
      latest = [...latest]
      latest[col] = Math.round(actual)
      applyColWidths(table, latest)
    }
    // 线按「实际渲染出来的边界」定位：列宽被内容最小宽 / 内容列宽上限钳住时，
    // 指针还会继续走，但线必须停在真正的分割线上（同步读 rect 会触发一次布局）
    const edge = table.rows[0].cells[col]?.getBoundingClientRect().right
    if (edge) showColBoundaryFeedback(table, edge, clip)
  }
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    endColResize()
    hideColBoundaryFeedback()
    if (active) onCommit(latest) // 纯点击：不提交、不广播
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  return true
}

/* ---------- 即显侧（ProseMirror 装饰器） ---------- */

const key = new PluginKey<number>('luci-table-widths')

/** 请求重绘：列宽记忆变化后派发空事务，装饰器随之重算 */
export function refreshTableWidths(view: PmView): void {
  view.dispatch(view.state.tr.setMeta(key, Date.now()))
}

/** 表头文本（PM 表格第一行单元格文本拼接，与 DOM 版 headerKeyOf 对齐） */
function headerKeyOfNode(tableNode: { firstChild: unknown }): string {
  const row = tableNode.firstChild as {
    forEach: (fn: (cell: { textContent: string }) => void) => void
  } | null
  if (!row) return ''
  const parts: string[] = []
  row.forEach((cell) => parts.push(cell.textContent.trim()))
  return parts.join('\u0001')
}

/** 即显侧列宽装饰器：记忆中的列宽以 node decoration style 形式由 PM 施加。
 *  getTabId 用于构造表格唯一键（标签 + 文档内序号 + 表头），切换标签时重算。 */
export function createTableWidthsPlugin(getTabId: () => number | string | null): Plugin<number> {
  return new Plugin<number>({
    key,
    state: {
      init: () => 0,
      apply: (tr, prev) => {
        const meta = tr.getMeta(key) as number | undefined
        return meta ?? prev
      },
    },
    props: {
      decorations: (state): DecorationSet => {
        const decos: Decoration[] = []
        const tabId = getTabId() ?? 'x'
        let tableIndex = -1
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'table') return true
          tableIndex++
          const widths = getColWidths(tableKey(tabId, tableIndex, headerKeyOfNode(node)))
          if (!widths || widths.length < 1) return false
          const total = widths.reduce((a, b) => a + b, 0)
          if (total <= 0) return false
          decos.push(
            Decoration.node(pos, pos + node.nodeSize, {
              // 这条装饰落在 pm-table-view 的 nodeView 外壳（.luci-table-wrap）上，
              // 不是内层 <table>：宽度给外壳、max-width 必须保留 100% 封顶，
              // 否则外壳随表格一起变宽，内容列宽上限失效（表格顶出正文列）。
              style: `width: ${Math.round(total)}px; max-width: 100%; min-width: 0`,
            })
          )
          node.forEach((row, rowOffset) => {
            row.forEach((cell, cellOffset, cellIndex) => {
              // 第二个参数是行内容内的偏移（拼接位置用），列号必须取第三个参数
              const idx = cellIndex
              if (idx >= widths.length) return
              const from = pos + 1 + rowOffset + 1 + cellOffset
              const to = from + cell.nodeSize
              decos.push(
                Decoration.node(from, to, {
                  style: `width: ${Math.round(widths[idx])}px`,
                })
              )
            })
          })
          return false
        })
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
}

