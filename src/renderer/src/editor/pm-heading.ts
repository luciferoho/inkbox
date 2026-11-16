import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { liftListItem } from '@milkdown/kit/prose/schema-list'

/**
 * 即显设标题（WysiwygEditor 快捷键 Ctrl+1..6 与右键「段落转换→标题N」共用）：
 * 语义与源码 setHeading 对齐——单行块整块转；多软行块（含硬换行的段落/标题）
 * 先按行拆开，只把光标/选区所在行设级，其余行退回正文；同级再按退回正文（toggle）。
 * 之前右键菜单对多软行块直接整块 setNodeMarkup，四行软行全被卷进同一个标题；
 * 快捷键路径光标恰在硬换行位置时映射偏移，标题设到下一行——两条路径统一收口于此。
 */

/** 光标当前所在标题级别（不在标题内为 null） */
export function curHeadingLevel(state: EditorState): number | null {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'heading') return Number($from.node(d).attrs.level ?? 1)
  }
  return null
}

/** 块内是否含硬换行（软行） */
export function hasHardbreaks(node: PMNode): boolean {
  let found = false
  node.forEach((child) => {
    if (child.type.name === 'hardbreak') found = true
  })
  return found
}

/**
 * 设标题级别。parent 不是段落/标题时（NodeSelection 等边界）走 fallback
 * （组件传 milkdown 命令路径保持旧行为）；未传 fallback 则父块原地转标题。
 */
export function pmSetHeading(
  view: EditorView,
  level: number,
  fallback?: (state: EditorState, level: number) => boolean
): boolean {
  const { state } = view
  const { from, to, $from } = state.selection
  const parent = $from.parent
  const headingT = state.schema.nodes.heading
  const paraT = state.schema.nodes.paragraph
  if (!headingT || !paraT) return false
  if (parent.type.name !== 'paragraph' && parent.type.name !== 'heading') {
    if (fallback) return fallback(state, level)
    const tr = state.tr.setNodeMarkup($from.before(), headingT, { level })
    view.dispatch(tr.scrollIntoView())
    return true
  }
  if (!hasHardbreaks(parent)) {
    const same = parent.type.name === 'heading' && Number(parent.attrs.level ?? 1) === level
    // 列表项内转标题：先整项提升出列表再设级别（Typora 语义；列表内直接改
    // paragraph → heading 会被列表结构吞掉，表现为按键无反应）
    let listDepth = -1
    for (let d = $from.depth; d >= 1; d--) {
      const nm = $from.node(d).type.name
      if (nm === 'bullet_list' || nm === 'ordered_list') {
        listDepth = d
        break
      }
    }
    if (listDepth >= 0) {
      const itemType = state.schema.nodes.list_item
      if (!itemType || !liftListItem(itemType)(state, view.dispatch)) return false
      const st2 = view.state
      if (!(st2.selection instanceof TextSelection)) return false
      const at2 = st2.selection.$from.before()
      const tr2 = st2.tr.setNodeMarkup(at2, same ? paraT : headingT, same ? undefined : { level })
      view.dispatch(tr2.scrollIntoView())
      return true
    }
    // 单行块：toggle（同级 → 正文）。直接 setNodeMarkup——milkdown 的
    // wrapInHeadingCommand 在「光标在段落末尾」等边界会误伤相邻块（实测把
    // 下一行设为标题），与右键「段落转换」共用同一语义
    const at = $from.before()
    const tr = state.tr
    tr.setNodeMarkup(at, same ? paraT : headingT, same ? undefined : { level })
    view.dispatch(tr.scrollIntoView())
    return true
  }
  // 多软行块：拆行 + 与选区相交的行设级、其余行退回正文（一次事务）
  const start = $from.start()
  const hbs: number[] = []
  parent.forEach((child, offset) => {
    if (child.type.name === 'hardbreak') hbs.push(start + offset)
  })
  const tr = state.tr
  for (let i = hbs.length - 1; i >= 0; i--) {
    const p = hbs[i]
    tr.split(p)
    // split 在 p 处插入闭合/开启 token，硬换行随映射移到 p+2：按 mapping 取真实位置删除
    const hp = tr.mapping.map(p, 1)
    tr.delete(hp, hp + 1)
  }
  // 选区端点必须 assoc=-1 映射：光标恰在硬换行位置（行尾）时，默认 +1 会把它
  // 连同拆行插入的闭合 token 一起顶到下一行开头，标题就设到下一行去了
  const mappedFrom = tr.mapping.map(from, -1)
  const mappedTo = tr.mapping.map(to, -1)
  const lineCount = hbs.length + 1
  const lines: { pos: number; node: PMNode }[] = []
  let pos = tr.mapping.map($from.before())
  for (let i = 0; i < lineCount; i++) {
    const node = tr.doc.nodeAt(pos)
    if (!node) break
    lines.push({ pos, node })
    pos += node.nodeSize
  }
  // 光标所在行：行尾归属当前行（首个「行尾 ≥ 光标」的行）
  const caretIdx = Math.max(
    0,
    lines.findIndex((l) => mappedFrom <= l.pos + l.node.nodeSize)
  )
  let touched = false
  lines.forEach((l, i) => {
    const lineTo = l.pos + l.node.nodeSize
    // 范围选区：与选区相交的行都设级；纯光标：只设所在行
    const hit = from !== to ? mappedTo > l.pos && mappedFrom < lineTo : i === caretIdx
    if (hit) {
      tr.setNodeMarkup(l.pos, headingT, { level })
      touched = true
    } else if (l.node.type.name !== 'paragraph') {
      tr.setNodeMarkup(l.pos, paraT)
    }
  })
  if (!touched && lines[caretIdx]) {
    tr.setNodeMarkup(lines[caretIdx].pos, headingT, { level })
  }
  view.dispatch(tr.scrollIntoView())
  return true
}
