import { NodeSelection, Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

/**
 * 即显元素工具条（图片/表格上下文浮层,数据层）：
 * - 点击图片（NodeSelection）或光标进入表格 → 通知 Vue 层显示浮层
 * - 浮层坐标为 .wysiwyg-host 内的绝对坐标,随文档编辑/滚动实时跟随
 * - selection 离开目标（点别处/删除）→ 通知隐藏
 */

export interface ElToolbarState {
  kind: 'image' | 'table'
  /** 目标节点位置（操作时按此定位,随每次 update 刷新） */
  pos: number
  /** 相对 host 的矩形（浮层定位用,内容坐标:滚动容器内的绝对位置） */
  rect: { x: number; y: number; w: number; h: number }
  /** host 可视区顶部的内容坐标 + 余量:浮层贴图片上方时不得低于此线,
   *  否则滚动到图片顶到可视区时浮层会被 host 顶边裁掉（地址行整行消失） */
  minY: number
  /** 表格:光标所在行/列（0 基） */
  row: number
  col: number
  canDeleteRow: boolean
  canDeleteCol: boolean
}

interface Target {
  kind: 'image' | 'table'
  pos: number
}

function findTarget(view: EditorView): Target | null {
  const { selection, doc } = view.state
  if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
    return { kind: 'image', pos: selection.from }
  }
  const $head = selection.$head
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type.name === 'table') {
      return { kind: 'table', pos: $head.before(d) }
    }
  }
  void doc
  return null
}

/** 表格上下文:光标行列与可删性（结构统计,基于当前 selection） */
function tableMeta(state: EditorState): Pick<ElToolbarState, 'row' | 'col' | 'canDeleteRow' | 'canDeleteCol'> {
  const $h = state.selection.$head
  let cell: PMNode | null = null
  let row: PMNode | null = null
  let table: PMNode | null = null
  for (let d = $h.depth; d > 0; d--) {
    const n = $h.node(d)
    if (n.type.name === 'table_cell' || n.type.name === 'table_header') cell ??= n
    else if (n.type.name === 'table_row') row ??= n
    else if (n.type.name === 'table') table ??= n
  }
  let rowIndex = 0
  let colIndex = 0
  if (table && row) table.forEach((_c, _o, i) => {
    if (_c === row) rowIndex = i
  })
  if (row && cell) row.forEach((c, _o, i) => {
    if (c === cell) colIndex = i
  })
  return {
    row: rowIndex,
    col: colIndex,
    canDeleteRow: !!table && table.childCount > 1,
    canDeleteCol: !!table && table.childCount > 0 && table.child(0).childCount > 1
  }
}

const key = new PluginKey('luci-element-toolbar')

export function createElementToolbar(
  onChange: (s: ElToolbarState | null) => void
): Plugin<null> {
  /** 同一状态不重复通知（rect 未变时不刷） */
  let lastJson = ''

  const sync = (view: EditorView): void => {
    const t = findTarget(view)
    if (!t) {
      if (lastJson !== '') {
        lastJson = ''
        onChange(null)
      }
      return
    }
    const dom = view.nodeDOM(t.pos)
    const host = view.dom.closest('.wysiwyg-host')
    if (!(dom instanceof HTMLElement) || !host) return
    const ir = dom.getBoundingClientRect()
    const hr = host.getBoundingClientRect()
    const base: Omit<ElToolbarState, 'row' | 'col' | 'canDeleteRow' | 'canDeleteCol'> = {
      kind: t.kind,
      pos: t.pos,
      rect: {
        x: ir.left - hr.left + host.scrollLeft,
        y: ir.top - hr.top + host.scrollTop,
        w: ir.width,
        h: ir.height
      },
      minY: host.scrollTop + 6
    }
    const meta =
      t.kind === 'table'
        ? tableMeta(view.state)
        : { row: 0, col: 0, canDeleteRow: false, canDeleteCol: false }
    const next: ElToolbarState = { ...base, ...meta }
    const json = JSON.stringify(next)
    if (json !== lastJson) {
      lastJson = json
      onChange(next)
    }
  }

  return new Plugin({
    key,
    props: {
      /** 点击后主动同步:重复点击已选中的图不产生事务,update 不会触发 */
      handleClickOn: (view) => {
        window.setTimeout(() => sync(view), 0)
        return false
      }
    },
    view: (editorView) => {
      const host = editorView.dom.closest('.wysiwyg-host')
      const onScroll = (): void => sync(editorView)
      host?.addEventListener('scroll', onScroll, { passive: true })
      return {
        update: (v) => sync(v),
        destroy: () => {
          host?.removeEventListener('scroll', onScroll)
          if (lastJson !== '') {
            lastJson = ''
            onChange(null)
          }
        }
      }
    }
  })
}
