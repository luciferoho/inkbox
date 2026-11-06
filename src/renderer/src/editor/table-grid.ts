import { reactive } from 'vue'
import type { EditorView as PMView } from '@milkdown/kit/prose/view'
import { pmViews } from './pm-registry'
import { cmViews } from './cm-registry'

/**
 * 表格行列选择器（5.6，渲染层自绘，TableGridPicker.vue 渲染）：
 * Ctrl+T / 插入面板 / 右键「插入→表格」时弹出 5×5 网格 hover 选择，替代固定 2 列。
 * - 锚点 = 触发时光标位置（即显 coordsAtPos / 源码 coordsAtPos），下方空间不足上翻
 * - 打开不抢焦点（容器 mousedown.prevent），Esc/点外/失焦取消；点格插入后焦点交回编辑器
 * - 插入动作经动态 import 走 insert-commands（该模块静态依赖本模块，避免初始化环）
 */

export interface TableGridState {
  open: boolean
  /** 锚点（光标坐标），TableGridPicker.vue 换算浮层位置 */
  ax: number
  ay: number
  /** 触发时所在的编辑器（插入落点） */
  target: 'pm' | 'cm'
  /** hover 高亮的子矩形（1..5），0 = 无 hover */
  rows: number
  cols: number
}

export const tableGrid = reactive<TableGridState>({
  open: false,
  ax: 0,
  ay: 0,
  target: 'pm',
  rows: 0,
  cols: 0
})

export function closeTableGrid(): void {
  tableGrid.open = false
  tableGrid.rows = 0
  tableGrid.cols = 0
}

function liveView(target: 'pm' | 'cm'): PMView | NonNullable<ReturnType<typeof cmViews>[number]> | null {
  if (target === 'pm') {
    return pmViews().filter((v) => v && v.dom && v.dom.isConnected).pop() ?? null
  }
  return cmViews().filter((v) => v && v.dom && v.dom.isConnected).pop() ?? null
}

/** 打开网格选择器（锚在光标处）；目标编辑器不存在时不弹 */
export function openTableGrid(target: 'pm' | 'cm', view?: PMView | NonNullable<ReturnType<typeof cmViews>[number]>): void {
  const v = view ?? liveView(target)
  if (!v) return
  try {
    let head: number
    if (target === 'pm') {
      head = (v as PMView).state.selection.head ?? (v as PMView).state.selection.from
    } else {
      head = (v as NonNullable<ReturnType<typeof cmViews>[number]>).state.selection.main.head
    }
    const c = v.coordsAtPos(head)
    if (!c) return
    tableGrid.ax = c.left
    tableGrid.ay = c.bottom
  } catch {
    return
  }
  tableGrid.target = target
  tableGrid.rows = 0
  tableGrid.cols = 0
  tableGrid.open = true
}

/** 点格插入 rows×cols 表格并收起 */
export async function pickTableGrid(rows: number, cols: number): Promise<void> {
  const target = tableGrid.target
  closeTableGrid()
  const { insertTableDims } = await import('./insert-commands')
  insertTableDims(target, rows, cols)
}
