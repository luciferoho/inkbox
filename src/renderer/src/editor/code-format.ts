/**
 * 代码块内容格式化（M6 6.3）：prettier standalone + sql-formatter 全部惰性动态
 * 加载（不进启动包，同 turndown 模式）。语言映射只认常见别名，未映射/无格式化器
 * 的语言 toast 提示不做；语法错误 toast 报错、内容不动。默认配置（2 空格缩进），
 * 不做设置 UI。入口：代码块工具栏按钮 / 右键菜单 / Shift+Alt+F（双端同键位）。
 */

import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { EditorView as PMView } from '@milkdown/kit/prose/view'
import type { EditorView as CmView } from '@codemirror/view'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

interface FormatResult {
  ok: boolean
  text?: string
  error?: string
  unsupported?: boolean
}

export interface FormatOutcome {
  applied: boolean
  reason?: 'unsupported' | 'error' | 'same' | 'notfound'
  error?: string
}

/** 失败/不支持时 toast（成功静默；按钮路径自行做轻反馈） */
function toastOutcome(o: FormatOutcome): void {
  if (o.applied) return
  const ui = useUiStore()
  if (o.reason === 'unsupported') ui.showToast(t('code.fmtUnsupported'))
  else if (o.reason === 'error') ui.showToast(`${t('code.fmtFailed')}${o.error ?? ''}`)
}

/** 语言别名 → prettier parser；sql 单独走 sql-formatter */
const PARSER_OF: Record<string, string> = {
  js: 'babel',
  jsx: 'babel',
  javascript: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  json: 'json',
  json5: 'json5',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  html: 'html',
  vue: 'html',
  svelte: 'html',
  xml: 'html',
  svg: 'html',
  md: 'markdown',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  graphql: 'graphql',
  gql: 'graphql'
}

const SQL_LANGS = new Set(['sql', 'plsql', 'tsql', 'mysql', 'postgresql', 'postgres', 'sqlite'])

type PrettierModule = {
  format: (source: string, options: Record<string, unknown>) => Promise<string>
}

let prettierMod: Promise<PrettierModule | null> | null = null
const pluginCache = new Map<string, Promise<unknown[]>>()

function loadPrettier(): Promise<PrettierModule | null> {
  prettierMod ??= import('prettier/standalone')
    .then((m) => {
      const mod = m as unknown as { format?: PrettierModule['format'] } & Record<string, unknown>
      const fn = (mod.default as PrettierModule | undefined)?.format ?? mod.format
      return fn ? { format: fn } : null
    })
    .catch(() => null)
  return prettierMod
}

/** 按 parser 惰性装配所需插件。必须直写字面量动态导入——变量形式的
 *  `import(p)` vite 无法改写裸模块名，浏览器运行时直接解析失败 */
function loadPlugins(parser: string): Promise<unknown[]> {
  const cache = pluginCache.get(parser)
  if (cache) return cache
  let p: Promise<unknown[]>
  switch (parser) {
    case 'typescript':
      p = Promise.all([import('prettier/plugins/typescript'), import('prettier/plugins/estree')])
      break
    case 'json':
    case 'json5':
    case 'babel':
      p = Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree')])
      break
    case 'css':
    case 'scss':
    case 'less':
      p = Promise.all([import('prettier/plugins/postcss')])
      break
    case 'html':
      p = Promise.all([
        import('prettier/plugins/html'),
        import('prettier/plugins/babel'),
        import('prettier/plugins/postcss')
      ])
      break
    case 'markdown':
      p = import('prettier/plugins/markdown').then((m) => [m])
      break
    case 'yaml':
      p = import('prettier/plugins/yaml').then((m) => [m])
      break
    case 'graphql':
      p = import('prettier/plugins/graphql').then((m) => [m])
      break
    default:
      p = Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree')])
  }
  const out = p.then((arr) => arr as unknown[])
  pluginCache.set(parser, out)
  return out
}

async function formatWithPrettier(parser: string, code: string): Promise<FormatResult> {
  const [mod, plugins] = await Promise.all([loadPrettier(), loadPlugins(parser)])
  if (!mod) return { ok: false, error: 'loader' }
  try {
    const text = await mod.format(code, { parser, plugins, tabWidth: 2 })
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split('\n')[0] : 'error' }
  }
}

async function formatSql(code: string): Promise<FormatResult> {
  try {
    const m = await import('sql-formatter')
    const mod = (m as unknown as { format?: typeof m.format; default?: typeof m }).default ?? m
    const fn = mod.format
    const text = fn(code, { language: 'postgresql', tabWidth: 2 })
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split('\n')[0] : 'error' }
  }
}

/** 按语言格式化代码；未支持语言 unsupported=true（调用方提示后原样返回） */
export async function formatCode(lang: string, code: string): Promise<FormatResult> {
  const l = lang.trim().toLowerCase()
  if (!l) return { ok: false, unsupported: true }
  if (SQL_LANGS.has(l)) return formatSql(code)
  const parser = PARSER_OF[l]
  if (!parser) return { ok: false, unsupported: true }
  return formatWithPrettier(parser, code)
}

/* ---------- 编辑器操作（即显/源码，toast 内聚） ---------- */

/** 源码：光标是否在围栏内（键位放行判定用，同步） */
export function cmInFence(view: CmView): boolean {
  let nd: SyntaxNode | null = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1)
  while (nd) {
    if (nd.name === 'FencedCode') return true
    nd = nd.parent
  }
  return false
}

/** 即显：格式化指定代码块（工具栏按钮路径，按块位置）。单事务替换文本 */
export async function pmFormatCodeAt(view: PMView, pos: number): Promise<FormatOutcome> {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'code_block') return { applied: false, reason: 'notfound' }
  return applyPmFormat(view, node, pos)
}

/** 即显：格式化光标所在代码块（快捷键/右键路径） */
export async function pmFormatCodeBlock(view: PMView): Promise<FormatOutcome> {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'code_block') {
      return applyPmFormat(view, $from.node(d), $from.before(d))
    }
  }
  return { applied: false, reason: 'notfound' }
}

async function applyPmFormat(view: PMView, node: PMNode, pos: number): Promise<FormatOutcome> {
  const r = await formatCode(String(node.attrs.language ?? ''), node.textContent)
  if (!r.ok) {
    const o: FormatOutcome = {
      applied: false,
      reason: r.unsupported ? 'unsupported' : 'error',
      error: r.error
    }
    toastOutcome(o)
    return o
  }
  if (r.text === node.textContent) return { applied: false, reason: 'same' }
  const tr = view.state.tr
  tr.insertText(r.text ?? '', pos + 1, pos + node.nodeSize - 1)
  view.dispatch(tr.scrollIntoView())
  return { applied: true }
}

/** 源码：格式化光标所在围栏（语法树定位，单事务替换围栏体） */
export async function cmFormatCodeBlock(view: CmView): Promise<FormatOutcome> {
  const head = view.state.selection.main.head
  let nd: SyntaxNode | null = syntaxTree(view.state).resolveInner(head, -1)
  let fence: SyntaxNode | null = null
  while (nd) {
    if (nd.name === 'FencedCode') {
      fence = nd
      break
    }
    nd = nd.parent
  }
  if (!fence) return { applied: false, reason: 'notfound' }
  const openLine = view.state.doc.lineAt(fence.from)
  const lang = /^(```+|~~~+)[ \t]*([\w+-]*)/.exec(openLine.text)?.[2] ?? ''
  const closeLine = view.state.doc.lineAt(fence.to)
  const bodyFrom = openLine.to + 1
  const bodyTo = Math.max(bodyFrom, closeLine.from)
  const code = view.state.sliceDoc(bodyFrom, bodyTo)
  const r = await formatCode(lang, code)
  if (!r.ok) {
    const o: FormatOutcome = { applied: false, reason: r.unsupported ? 'unsupported' : 'error', error: r.error }
    toastOutcome(o)
    return o
  }
  if (r.text === code) return { applied: false, reason: 'same' }
  view.dispatch({
    changes: { from: bodyFrom, to: bodyTo, insert: r.text ?? '' },
    scrollIntoView: true
  })
  return { applied: true }
}
