import { reactive } from 'vue'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorView as PMView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { wrapIn, lift } from '@milkdown/kit/prose/commands'
import { wrapInList, liftListItem } from '@milkdown/kit/prose/schema-list'
import { t } from '@/i18n'
import { accelKeys, effectiveShortcuts } from '@shared/shortcuts'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { INSERT_COMMANDS, runInsertCommand } from './insert-commands'
import { pmSetHeading } from './pm-heading'
import { useUiStore } from '@/stores/ui'

/**
 * 正文右键菜单（5.8，渲染层自绘，TextContextMenu.vue 渲染）：
 * 剪贴板操作 + 段落转换 + 「插入」子菜单（复用 5.4 命令层）。
 * - 仅在编辑器文本上触发；图片/表格右键各有专用菜单，命中后不再弹本菜单
 * - 条目动态：代码块/公式等块内只出剪贴板组（Typora 语义）；未选中时
 *   剪切/复制禁用
 * - 快捷键展示：段落转换/格式类为固定键；可改键命令（图片等）读
 *   effectiveShortcuts 显示实际设置
 */

export interface TextMenuItem {
  id: string
  label: string
  /** 右侧展示的快捷键（展示用，动作不走它） */
  accel?: string
  disabled?: boolean
  /** 子菜单（插入命令 / 段落转换） */
  children?: TextMenuItem[]
}

export const textMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  /** 打开菜单时捕捉的编辑器（剪贴板/转换/插入都用它） */
  target: 'pm' as 'pm' | 'cm',
  items: [] as TextMenuItem[]
})

export function closeTextMenu(): void {
  textMenu.open = false
}

function livePm(): PMView | null {
  return pmViews().filter((v) => v && v.dom && v.dom.isConnected).pop() ?? null
}

function liveCm(): NonNullable<ReturnType<typeof cmViews>>[number] | null {
  return cmViews().filter((v) => v && v.dom && v.dom.isConnected).pop() ?? null
}

/** 展示用键帽：CmdOrCtrl → Ctrl */
function accelText(accel: string): string {
  return accelKeys(accel).join('+')
}

/** 可改键命令的实际加速键（读 ui.shortcuts 覆盖表）；未注册/被禁用返回空 */
function commandAccel(id: string): string {
  const eff = effectiveShortcuts(useUiStore().shortcuts)[id]
  return eff ? accelText(eff) : ''
}

/** PM：光标是否在代码块/公式/HTML 块/TOC/yaml 内（这些块里不提供转换/插入） */
function pmInBlock(): boolean {
  const view = livePm()
  if (!view) return true
  const { $from } = view.state.selection
  const BLOCKS = new Set(['code_block', 'math_block', 'math_inline', 'html_table', 'yaml', 'toc'])
  for (let d = $from.depth; d >= 0; d--) {
    if (BLOCKS.has($from.node(d).type.name)) return true
  }
  return false
}

/** CM：光标是否在围栏代码/HTML 块内（lezer 语法树祖先） */
function cmInBlock(): boolean {
  const view = liveCm()
  if (!view) return true
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(
    view.state.selection.main.head,
    -1
  )
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'HTMLBlock' || node.name === 'FrontMatter') return true
    node = node.parent
  }
  return false
}

function buildItems(target: 'pm' | 'cm'): TextMenuItem[] {
  const selEmpty =
    target === 'pm'
      ? (livePm()?.state.selection.empty ?? true)
      : (liveCm()?.state.selection.main.empty ?? true)
  const inBlock = target === 'pm' ? pmInBlock() : cmInBlock()
  /** labelKey 动态串走 string 签名（键由调用处静态保证） */
  const tl = (k: string): string => (t as unknown as (key: string) => string)(k)

  const clipboard: TextMenuItem[] = [
    { id: 'cut', label: tl('ctx.cut'), accel: 'Ctrl+X', disabled: selEmpty },
    { id: 'copy', label: tl('ctx.copy'), accel: 'Ctrl+C', disabled: selEmpty },
    { id: 'paste', label: tl('ctx.paste'), accel: 'Ctrl+V' },
    { id: 'selectAll', label: tl('ctx.selectAll'), accel: 'Ctrl+A' }
  ]
  if (inBlock) return clipboard

  const paraItems: TextMenuItem[] = [
    { id: 'para:h1', label: tl('ctx.paraH1'), accel: 'Ctrl+1' },
    { id: 'para:h2', label: tl('ctx.paraH2'), accel: 'Ctrl+2' },
    { id: 'para:h3', label: tl('ctx.paraH3'), accel: 'Ctrl+3' },
    { id: 'para:h4', label: tl('ctx.paraH4'), accel: 'Ctrl+4' },
    { id: 'para:h5', label: tl('ctx.paraH5'), accel: 'Ctrl+5' },
    { id: 'para:h6', label: tl('ctx.paraH6'), accel: 'Ctrl+6' },
    { id: 'para:body', label: tl('ctx.paraBody'), accel: 'Ctrl+0' },
    { id: 'para:ul', label: tl('sc.ulList'), accel: 'Ctrl+Shift+]' },
    { id: 'para:ol', label: tl('sc.olList'), accel: 'Ctrl+Shift+[' },
    { id: 'para:task', label: tl('ip.taskList') },
    { id: 'para:quote', label: tl('sc.quote'), accel: 'Ctrl+Shift+Q' },
    { id: 'para:code', label: tl('sc.codeBlock'), accel: 'Ctrl+Shift+K' }
  ]

  const ACCENTS: Record<string, string> = {
    table: 'Ctrl+T',
    codeBlock: 'Ctrl+Shift+K',
    math: 'Ctrl+Shift+M',
    link: 'Ctrl+K'
  }
  const insertItems: TextMenuItem[] = INSERT_COMMANDS.map((c) => ({
    id: 'insert:' + c.id,
    // 每次打开重建：跟随语言切换
    label: tl(c.labelKey),
    accel: ACCENTS[c.id] ?? (c.id === 'image' ? commandAccel('file:insertImage') : '')
  }))

  return [
    ...clipboard,
    { id: 'sep1', label: '-' },
    { id: 'para', label: t('ctx.paraConvert'), children: paraItems },
    { id: 'insert', label: t('ctx.insert'), children: insertItems }
  ]
}

/* ---------- 执行 ---------- */

export function runTextMenuAction(id: string): void {
  closeTextMenu()
  const target = textMenu.target
  if (id.startsWith('insert:')) {
    runInsertCommand(id.slice(7), target)
    return
  }
  if (id.startsWith('para:')) {
    runParaAction(id.slice(5), target)
    return
  }
  // 剪贴板走系统语义（execCommand 让原生编辑行为处理选区/粘贴清洗）
  if (id === 'cut') document.execCommand('cut')
  else if (id === 'copy') document.execCommand('copy')
  else if (id === 'paste') void pasteViaClipboard(target)
  else if (id === 'selectAll') {
    const v = target === 'pm' ? livePm() : liveCm()
    if (!v) return
    v.focus()
    // 块内（代码/公式/HTML 表格/yaml）：只选块内容，不选整篇文档
    if (target === 'pm') {
      const view = v as PMView
      const { $from } = view.state.selection
      const BLOCKS = new Set(['code_block', 'math_block', 'html_table', 'yaml'])
      for (let d = $from.depth; d >= 1; d--) {
        if (!BLOCKS.has($from.node(d).type.name)) continue
        const from = $from.before(d) + 1
        const to = $from.after(d) - 1
        if (to > from) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
        }
        return
      }
      document.execCommand('selectAll')
    } else {
      const view = v as NonNullable<ReturnType<typeof cmViews>>[number]
      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1)
      let fence: SyntaxNode | null = null
      while (node) {
        if (node.name === 'FencedCode' || node.name === 'HTMLBlock') { fence = node; break }
        node = node.parent
      }
      if (fence) {
        const openLine = view.state.doc.lineAt(fence.from)
        const closeLine = view.state.doc.lineAt(fence.to)
        view.dispatch({
          selection: { anchor: Math.min(openLine.to + 1, fence.to), head: closeLine.from }
        })
        return
      }
      document.execCommand('selectAll')
    }
  }
}

async function pasteViaClipboard(target: 'pm' | 'cm'): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
    const v = target === 'pm' ? livePm() : liveCm()
    if (!v) return
    if (target === 'pm') {
      const view = v as PMView
      if (!(view.state.selection instanceof TextSelection)) return
      const { from, to } = view.state.selection
      view.dispatch(view.state.tr.insertText(text, from, to))
    } else {
      const view = v as NonNullable<ReturnType<typeof cmViews>>[number]
      const head = view.state.selection.main.head
      view.dispatch(
        view.state.update({
          changes: { from: head, insert: text },
          selection: { anchor: head + text.length }
        })
      )
    }
  } catch {
    // 剪贴板权限受限时静默放弃
  }
}

/* ---------- 段落转换（单块简单语义） ---------- */

function runParaAction(action: string, target: 'pm' | 'cm'): void {
  if (target === 'cm') {
    runCmPara(action)
    return
  }
  const view = livePm()
  if (!view) return
  const { state } = view
  if (!(state.selection instanceof TextSelection)) return
  const { $from } = state.selection
  const paraT = state.schema.nodes.paragraph
  // 列表项内转块类型（标题/正文/代码块）：先整项提升出列表——列表内直接改
  // paragraph → heading 会被列表结构吞掉，表现为「点了没反应」（与快捷键路径同语义）
  if (action === 'body' || action === 'code' || /^h[1-6]$/.test(action)) {
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
      if (!itemType || !liftListItem(itemType)(state, view.dispatch)) return
    }
  }
  // 提升后重新取选区（文档已变）
  const cur = view.state.selection
  if (!(cur instanceof TextSelection)) return
  const $pos = cur.$from
  const tr = view.state.tr
  if (action.startsWith('h') && /^[1-6]$/.test(action[1] ?? '')) {
    // 与快捷键同一条路径（pm-heading）：多软行块先按行拆开、只设光标所在行，
    // 不再整段卷进同一个标题（与源码侧的行级语义一致，2026-10-31 反馈）
    pmSetHeading(view, Number(action[1]))
    return
  }
  switch (action) {
    case 'body':
      if ($pos.parent.type.name === 'heading') tr.setNodeMarkup($pos.before(), paraT)
      break
    case 'ul':
    case 'ol': {
      const listT = view.state.schema.nodes[action === 'ol' ? 'ordered_list' : 'bullet_list']
      if (listT) wrapInList(listT)(view.state, view.dispatch, view)
      return
    }
    case 'task': {
      const bl = view.state.schema.nodes.bullet_list
      if (!bl) return
      if (!wrapInList(bl)(view.state, view.dispatch, view)) return
      const sel = view.state.selection
      if (sel instanceof TextSelection) {
        for (let d = sel.$from.depth; d >= 1; d--) {
          if (sel.$from.node(d).type.name === 'list_item') {
            view.dispatch(view.state.tr.setNodeMarkup(sel.$from.before(d), undefined, { checked: false }))
            break
          }
        }
      }
      return
    }
    case 'quote': {
      const bqT = view.state.schema.nodes.blockquote
      if (!bqT) return
      let inQuote = false
      for (let d = $pos.depth; d >= 1; d--) {
        if ($pos.node(d).type.name === 'blockquote') inQuote = true
      }
      if (inQuote) lift(view.state, view.dispatch)
      else wrapIn(bqT)(view.state, view.dispatch, view)
      return
    }
    case 'code': {
      const codeT = view.state.schema.nodes.code_block
      if (!codeT) return
      tr.setNodeMarkup($pos.before(), codeT)
      break
    }
  }
  view.dispatch(tr.scrollIntoView())
}

function runCmPara(action: string): void {
  const view = liveCm()
  if (!view) return
  const { state } = view
  const range = state.selection.main
  const changes: { from: number; to: number; insert: string }[] = []
  const first = state.doc.lineAt(range.from).number
  const last = state.doc.lineAt(range.to).number
  const heading = /^h([1-6])$/.exec(action)
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n)
    const m = /^(#{1,6}[ \t]+|>[ \t]?|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/.exec(line.text)
    if (heading) {
      const prefix = '#'.repeat(Number(heading[1])) + ' '
      const cur = /^(#{1,6})[ \t]+/.exec(line.text)
      if (cur) {
        if (cur[1] !== '#'.repeat(Number(heading[1])))
          changes.push({ from: line.from, to: line.from + cur[0].length, insert: prefix })
      } else {
        changes.push({ from: line.from, to: line.from, insert: prefix })
      }
      continue
    }
    switch (action) {
      case 'body':
        if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: '' })
        break
      case 'ul':
        changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: '- ' })
        break
      case 'ol':
        changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: `${n - first + 1}. ` })
        break
      case 'task':
        changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: '- [ ] ' })
        break
      case 'quote':
        changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: '> ' })
        break
      case 'code': {
        // 整段包围栏：首行前插 ```，末行后插 ```
        if (n === first) changes.push({ from: line.from, to: line.from, insert: '```\n' })
        if (n === last) changes.push({ from: line.to, to: line.to, insert: '\n```' })
        break
      }
    }
  }
  if (changes.length) view.dispatch(state.update({ changes }))
}

/* ---------- 触发识别 ---------- */

export function initTextContextMenu(): void {
  document.addEventListener('contextmenu', (e) => {
    const el = e.target as HTMLElement | null
    if (!el) return
    // 菜单自身/图片/表格/输入框上的右键不接管（图片、表格有专用菜单）
    if (el.closest('.ctx-menu, .img-ctx-menu, .tbl-ctx-menu, input, textarea')) return
    if (el.closest('img, table')) return
    const inPm = el.closest('.ProseMirror')
    const inCm = el.closest('.cm-content')
    if (!inPm && !inCm) return
    const target: 'pm' | 'cm' = inPm ? 'pm' : 'cm'
    // 打开前把 PM 光标落到右键处（否则转换作用于原光标位置）；
    // 但点击点在已有选区内时必须保留选区——否则剪切/复制被折叠成空选区变禁用
    if (inPm) {
      const view = livePm()
      if (view) {
        const hit = view.posAtCoords({ left: e.clientX, top: e.clientY })
        const pos = hit ? hit.pos : null
        if (pos != null) {
          const sel = view.state.selection
          const inside = !sel.empty && pos >= sel.from && pos <= sel.to
          if (!inside) {
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
          }
        }
      }
    }
    textMenu.target = target
    textMenu.items = buildItems(target)
    textMenu.x = e.clientX
    textMenu.y = e.clientY
    textMenu.open = true
    e.preventDefault()
  })
  document.addEventListener('mousedown', (e) => {
    if (!textMenu.open) return
    // .ctx-submenu 是 Teleport 到 body 的独立浮层，不在 .ctx-menu 里，必须一并排除
    // ——否则点子菜单项时菜单先被关闭，按钮随 v-if 移除，click 事件丢失（表现为「点了没反应」）
    if ((e.target as HTMLElement | null)?.closest?.('.ctx-menu, .ctx-submenu')) return
    textMenu.open = false
  })
}
