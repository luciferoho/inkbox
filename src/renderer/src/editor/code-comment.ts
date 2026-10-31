import { syntaxTree } from '@codemirror/language'
import { TextSelection } from '@milkdown/kit/prose/state'
import { accelFromEvent, effectiveShortcuts, normalizeForCompare } from '@shared/shortcuts'
import { useUiStore } from '@/stores/ui'
import { pmViews } from './pm-registry'
import { cmViews } from './cm-registry'

/**
 * 代码块内 Ctrl+/ = 注释切换（Typora 语义），其余位置仍是「快捷键面板」。
 *
 * 主进程的 before-input-event 会拦截所有已注册加速键（含 view:toggleShortcuts），
 * 所以该命令在主进程放行（window.ts 里 `id === 'view:toggleShortcuts'` 直接 return），
 * 由这里按焦点上下文分流：在代码块内 → 切换注释；否则 → 打开/收起快捷键面板。
 *
 * 注释符按语言取（与 Typora 一致）：`//`、`#`、`--`、`%%`、`%` 行注释；
 * html/xml 与 css 家族没有安全的行注释，改用整块 `<!-- -->` / `/* *\/`。
 */

type CommentStyle = { kind: 'line'; token: string } | { kind: 'block'; open: string; close: string } | null

const SLASH = new Set([
  'javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx', 'java', 'c', 'cpp', 'c++', 'csharp', 'cs', 'c#',
  'go', 'golang', 'rust', 'rs', 'swift', 'kotlin', 'scala', 'dart', 'php', 'groovy', 'solidity', 'json', 'jsonc'
])
const HASH = new Set([
  'python', 'py', 'ruby', 'rb', 'bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'yaml', 'yml', 'toml',
  'ini', 'perl', 'r', 'makefile', 'dockerfile', 'elixir', 'julia', 'nix', 'coffee', 'coffeescript'
])
const DASH = new Set(['sql', 'lua', 'haskell', 'hs', 'ada'])
const PERCENT = new Set(['mermaid', 'matlab', 'tex', 'latex'])

function styleFor(lang: string): CommentStyle {
  const l = lang.trim().toLowerCase()
  if (!l) return { kind: 'line', token: '//' }
  if (SLASH.has(l)) return { kind: 'line', token: '//' }
  if (HASH.has(l)) return { kind: 'line', token: '#' }
  if (DASH.has(l)) return { kind: 'line', token: '--' }
  if (PERCENT.has(l)) return { kind: 'line', token: l === 'mermaid' ? '%%' : '%' }
  if (l === 'html' || l === 'xml' || l === 'vue' || l === 'svelte') {
    return { kind: 'block', open: '<!--', close: '-->' }
  }
  if (l === 'css' || l === 'scss' || l === 'less' || l === 'stylus') {
    return { kind: 'block', open: '/*', close: '*/' }
  }
  if (l === 'plaintext' || l === 'text' || l === 'txt' || l === 'markdown' || l === 'md') return null
  return { kind: 'line', token: '//' }
}

/** 对整块文本按行切换注释；返回新文本（与原文相同表示无变化） */
function toggleLines(text: string, fromLine: number, toLine: number, style: CommentStyle): string {
  if (!style) return text
  const lines = text.split('\n')
  const last = Math.min(toLine, lines.length - 1)
  if (style.kind === 'block') {
    // 块注释：整个选区包一层（已包则剥掉）
    const seg = lines.slice(fromLine, last + 1).join('\n')
    const trimmed = seg.trim()
    if (trimmed.startsWith(style.open) && trimmed.endsWith(style.close)) {
      const inner = seg.slice(seg.indexOf(style.open) + style.open.length)
      const withoutClose = inner.slice(0, inner.lastIndexOf(style.close))
      const repl = withoutClose.replace(/^\s*\n?/, '').replace(/\n?\s*$/, '')
      lines.splice(fromLine, last - fromLine + 1, ...repl.split('\n'))
    } else {
      lines.splice(fromLine, last - fromLine + 1, `${style.open} ${seg} ${style.close}`)
    }
    return lines.join('\n')
  }
  const token = style.token
  const indentOf = (l: string): string => (/^[ \t]*/.exec(l) ?? [''])[0]
  const isCommented = (l: string): boolean => {
    if (!l.trim()) return true // 空行不参与判定
    return l.slice(indentOf(l).length).startsWith(token)
  }
  const target = lines.slice(fromLine, last + 1)
  const contentful = target.filter((l) => l.trim())
  const allCommented = contentful.length > 0 && contentful.every(isCommented)
  for (let i = fromLine; i <= last; i++) {
    const line = lines[i]!
    if (!line.trim()) continue
    const indent = indentOf(line)
    if (allCommented) {
      const rest = line.slice(indent.length + token.length)
      lines[i] = indent + (rest.startsWith(' ') ? rest.slice(1) : rest)
    } else if (!line.slice(indent.length).startsWith(token)) {
      lines[i] = `${indent}${token} ${line.slice(indent.length)}`
    }
  }
  return lines.join('\n')
}

/** 光标所在代码块 + 选区对应的块内行号；非代码块返回 null */
function pmTarget(): { view: ReturnType<typeof pmViews>[number]; pos: number; node: any; start: number; end: number } | null {
  const view = pmViews().filter((v) => v && v.dom && v.dom.isConnected).pop()
  if (!view) return null
  const { state } = view
  const sel = state.selection
  if (!(sel instanceof TextSelection)) return null
  const $from = sel.$from
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (node.type.name !== 'code_block') continue
    const pos = $from.before(d)
    // 块内坐标：文本内容从 pos+1 开始
    const start = Math.max(0, sel.from - (pos + 1))
    const end = Math.max(0, sel.to - (pos + 1))
    return { view, pos, node, start, end }
  }
  return null
}

function cmTarget(): {
  view: ReturnType<typeof cmViews>[number]
  from: number
  to: number
  lang: string
  blockStart: number
  blockEnd: number
} | null {
  const view = cmViews().filter((v) => v && v.dom && v.dom.isConnected).pop()
  if (!view) return null
  const { state } = view
  const head = state.selection.main.head
  let node = syntaxTree(state).resolveInner(head, -1) as any
  let fence: any = null
  while (node) {
    if (node.name === 'FencedCode') { fence = node; break }
    node = node.parent
  }
  if (!fence) return null
  const firstLine = state.doc.lineAt(fence.from)
  const lastLine = state.doc.lineAt(fence.to)
  const blockStart = Math.min(firstLine.to + 1, state.doc.length)
  const blockEnd = Math.max(blockStart, lastLine.from)
  const lang = /^`{3,}\s*([\w#+.-]*)/.exec(firstLine.text)?.[1] ?? ''
  return {
    view,
    from: Math.max(blockStart, Math.min(state.selection.main.from, blockEnd)),
    to: Math.max(blockStart, Math.min(state.selection.main.to, blockEnd)),
    lang,
    blockStart,
    blockEnd
  }
}

/** 在代码块内则切换注释并返回 true */
export function toggleCommentAtCursor(): boolean {
  const pm = pmTarget()
  if (pm) {
    const text = pm.node.textContent
    const style = styleFor(String(pm.node.attrs.language ?? ''))
    if (!style) return true // 纯文本块：吞掉按键，不弹面板
    const offsetOf = (local: number): number => text.slice(0, Math.max(0, Math.min(local, text.length))).split('\n').length - 1
    const next = toggleLines(text, offsetOf(pm.start), offsetOf(pm.end), style)
    if (next === text) return true
    const { state } = pm.view
    const tr = state.tr.replaceWith(
      pm.pos + 1,
      pm.pos + pm.node.nodeSize - 1,
      state.schema.text(next)
    )
    const caret = pm.pos + 1 + Math.min(pm.start, next.length)
    tr.setSelection(TextSelection.near(tr.doc.resolve(caret)))
    pm.view.dispatch(tr)
    return true
  }
  const cm = cmTarget()
  if (cm) {
    const style = styleFor(cm.lang)
    if (!style) return true
    const { view, blockStart, blockEnd } = cm
    const { state } = view
    const text = state.sliceDoc(blockStart, blockEnd)
    const first = state.doc.lineAt(cm.from).number - state.doc.lineAt(blockStart).number
    const last = state.doc.lineAt(cm.to).number - state.doc.lineAt(blockStart).number
    const next = toggleLines(text, first, last, style)
    if (next === text) return true
    view.dispatch({ changes: { from: blockStart, to: blockEnd, insert: next } })
    return true
  }
  return false
}

/** 全局接管快捷键面板键：代码块内切注释，其余位置开关面板 */
export function initCodeCommentShortcut(): void {
  const ui = useUiStore()
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || e.isComposing) return
      const accel = accelFromEvent({
        key: e.key,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      })
      if (!accel) return
      const target = effectiveShortcuts(ui.shortcuts)['view:toggleShortcuts']
      if (!target || normalizeForCompare(accel) !== normalizeForCompare(target)) return
      const inCode = toggleCommentAtCursor()
      e.preventDefault()
      e.stopPropagation()
      if (!inCode) ui.toggleShortcutPanel()
    },
    true
  )
}
