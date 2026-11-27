/**
 * 代码块内容格式化（M6 6.3）：prettier standalone + sql-formatter + ruff(python wasm)
 * 全部惰性动态加载（不进启动包，同 turndown 模式）。语言映射只认常见别名，未映射/
 * 无格式化器的语言 toast 提示不做；语法错误 toast 报错、内容不动。默认配置（2 空格
 * 缩进；python 走 ruff 默认 4 空格），不做设置 UI。入口：代码块工具栏按钮 / 右键菜单 /
 * Shift+Alt+F（双端同键位）；按钮与右键菜单按 isFormatSupported 显隐（不支持的不给入口）。
 */

import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { EditorView as PMView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
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

/** 异常摘要：Error 取首行 message；ruff 对解析失败会 throw 纯字符串，同样照实取出 */
function errText(e: unknown): string {
  const s = e instanceof Error ? e.message : e == null ? '' : String(e)
  return s.split('\n')[0] || 'error'
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

const PYTHON_LANGS = new Set(['python', 'py'])

/** 语言是否支持格式化：块工具栏按钮与右键菜单项的显隐共用同一判据 */
export function isFormatSupported(lang: string): boolean {
  const l = lang.trim().toLowerCase()
  if (!l) return false
  return SQL_LANGS.has(l) || PYTHON_LANGS.has(l) || Object.hasOwn(PARSER_OF, l)
}

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
    return { ok: false, error: errText(e) }
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
    return { ok: false, error: errText(e) }
  }
}

/* python：ruff format 的 wasm 构建（vite 入口，?init 装配），黑魔法同源、默认 4 空格 */
type RuffModule = typeof import('@wasm-fmt/ruff_fmt/vite')
let ruffMod: Promise<RuffModule | null> | null = null

function loadRuff(): Promise<RuffModule | null> {
  ruffMod ??= import('@wasm-fmt/ruff_fmt/vite')
    .then(async (m) => {
      await m.default() // 实例化 wasm（幂等）
      return m
    })
    .catch(() => null)
  return ruffMod
}

async function formatPython(code: string): Promise<FormatResult> {
  try {
    const mod = await loadRuff()
    if (!mod) return { ok: false, error: 'loader' }
    return { ok: true, text: mod.format(code) }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/** 按语言格式化代码；未支持语言 unsupported=true（调用方提示后原样返回） */
export async function formatCode(lang: string, code: string): Promise<FormatResult> {
  const l = lang.trim().toLowerCase()
  if (!l) return { ok: false, unsupported: true }
  if (SQL_LANGS.has(l)) return formatSql(code)
  if (PYTHON_LANGS.has(l)) return formatPython(code)
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

/** 即显：光标所在代码块的语言标签（不在代码块返回 null；空语言返回 ''） */
export function pmCodeLangAt(view: PMView): string | null {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d)
    if (n.type.name === 'code_block') return String(n.attrs.language ?? '')
  }
  return null
}

/** 源码：光标所在围栏的语言标签（不在围栏返回 null；空语言返回 ''） */
export function cmFenceLang(view: CmView): string | null {
  let nd: SyntaxNode | null = syntaxTree(view.state).resolveInner(view.state.selection.main.head, -1)
  while (nd) {
    if (nd.name === 'FencedCode') {
      const openLine = view.state.doc.lineAt(nd.from)
      return /^(```+|~~~+)[ \t]*([\w+-]*)/.exec(openLine.text)?.[2] ?? ''
    }
    nd = nd.parent
  }
  return null
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
  // 代码块文本以换行收尾 = 多一个空行：formatter 统一补的末尾换行按原文结尾形态
  // 归一（原文不带换行就剥掉），保证格式化不新增行
  let text = (r.text ?? '').replace(/[\r\n]+$/, '')
  if (node.textContent.endsWith('\n')) text += '\n'
  if (text === node.textContent) return { applied: false, reason: 'same' }
  const from = pos + 1
  const to = pos + node.nodeSize - 1
  // 选区在块内时按原偏移重设：整块替换会把选区默认映射到替换区末尾（光标窜到最后一行）
  const sel = view.state.selection
  const selIn = sel.from >= from && sel.to <= to
  const relA = sel.from - from
  const relB = sel.to - from
  const tr = view.state.tr
  tr.insertText(text, from, to)
  if (selIn) {
    const clamp = (n: number): number => from + Math.min(Math.max(n, 0), text.length)
    tr.setSelection(TextSelection.create(tr.doc, clamp(relA), clamp(relB)))
  }
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
  // 围栏体以换行收尾（``` 独立成行）：保持原文结尾形态——少了补上（否则闭栏并到
  // 末行），formatter 多补的剥掉（不新增空行）
  let text = r.text ?? ''
  if (code.endsWith('\n')) {
    if (!text.endsWith('\n')) text += '\n'
  } else {
    text = text.replace(/[\r\n]+$/, '')
  }
  if (text === code) return { applied: false, reason: 'same' }
  // 选区在围栏体内时按原偏移重设（默认映射会把选区甩到替换区边界）
  const sel = view.state.selection.main
  const selIn = sel.from >= bodyFrom && sel.to <= bodyTo
  const relA = sel.from - bodyFrom
  const relB = sel.to - bodyFrom
  view.dispatch({
    changes: { from: bodyFrom, to: bodyTo, insert: text },
    ...(selIn
      ? {
          selection: {
            anchor: bodyFrom + Math.min(Math.max(relA, 0), text.length),
            head: bodyFrom + Math.min(Math.max(relB, 0), text.length)
          }
        }
      : {}),
    scrollIntoView: true
  })
  return { applied: true }
}
