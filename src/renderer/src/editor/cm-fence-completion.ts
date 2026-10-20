import {
  autocompletion,
  completionStatus,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from '@codemirror/autocomplete'
import { Prec, type Extension, type EditorState } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'

/**
 * 代码块语言补全（Typora 效果，源码/双栏的 CodeMirror 侧）：
 * - 敲出 ``` 后立即弹语言候选列表，继续输入字母即过滤
 * - 选中候选拼 Enter / 手敲语言后按 Enter：整行替换为 ```语言 + 空行 + 收尾 ```，
 *   光标落到代码块内空行，直接开写
 * - 仅当该行是「新块的开栏」（此前围栏成对出现）才接管；编辑已有代码块不受影响
 */

interface LangDef {
  label: string
  aliases?: string[]
}

const LANGS: LangDef[] = [
  { label: 'javascript', aliases: ['js'] },
  { label: 'typescript', aliases: ['ts'] },
  { label: 'python', aliases: ['py'] },
  { label: 'java' },
  { label: 'c' },
  { label: 'cpp', aliases: ['c++'] },
  { label: 'csharp', aliases: ['cs', 'c#'] },
  { label: 'go', aliases: ['golang'] },
  { label: 'rust', aliases: ['rs'] },
  { label: 'ruby', aliases: ['rb'] },
  { label: 'php' },
  { label: 'swift' },
  { label: 'kotlin' },
  { label: 'scala' },
  { label: 'dart' },
  { label: 'bash', aliases: ['shell', 'sh', 'zsh'] },
  { label: 'powershell', aliases: ['ps1'] },
  { label: 'json' },
  { label: 'yaml', aliases: ['yml'] },
  { label: 'toml' },
  { label: 'xml' },
  { label: 'html' },
  { label: 'css' },
  { label: 'scss' },
  { label: 'less' },
  { label: 'sql' },
  { label: 'markdown', aliases: ['md'] },
  { label: 'dockerfile', aliases: ['docker'] },
  { label: 'makefile' },
  { label: 'lua' },
  { label: 'perl' },
  { label: 'r' },
  { label: 'objectivec', aliases: ['objc'] },
  { label: 'haskell', aliases: ['hs'] },
  { label: 'elixir' },
  { label: 'erlang' },
  { label: 'clojure' },
  { label: 'groovy' },
  { label: 'vim' },
  { label: 'ini' },
  { label: 'diff' },
  { label: 'plaintext', aliases: ['text', 'txt'] }
]

/** 本行是否 ```开栏 形态（可带缩进/语言字符）；返回捕获的语言片段 */
function fenceLine(text: string): string | null {
  const m = /^[ \t]*```([a-zA-Z0-9+#._-]*)[ \t]*$/.exec(text)
  return m ? m[1] : null
}

/** 光标前行号之前文档的围栏行数是否成对（成对 = 本行是「新块的开栏」而非已有块内部） */
function opensNewBlock(state: EditorState, lineNumber: number): boolean {
  let fences = 0
  for (let i = 1; i < lineNumber; i++) {
    if (/^[ \t]*```/.test(state.doc.line(i).text)) fences++
  }
  return fences % 2 === 0
}

/** 本行之后是否还有围栏行：有 = 这是已有代码块的开栏（改语言场景），不该再补收尾 */
function hasClosingFenceAfter(state: EditorState, lineNumber: number): boolean {
  for (let i = lineNumber + 1; i <= state.doc.lines; i++) {
    if (/^[ \t]*```/.test(state.doc.line(i).text)) return true
  }
  return false
}

/** 把当前 ```行 整行替换为 ```lang + 空行 + 收尾```，光标落代码块内空行 */
function closeFence(view: EditorView, lang: string): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: '```' + lang + '\n\n```' },
    selection: { anchor: line.from + 3 + lang.length + 1 },
    userEvent: 'input.complete'
  })
}

/** 围栏语言补全源（导出供测试直接调用） */
export const fenceLangSource = (context: CompletionContext): CompletionResult | null => {
  const m = context.matchBefore(/[ \t]*```([a-zA-Z0-9+#._-]*)$/)
  if (!m) return null
  const lineNo = context.state.doc.lineAt(context.pos).number
  if (!opensNewBlock(context.state, lineNo)) return null
  // 已有收尾围栏（改语言场景）：只替换语言词，不重复补 ```（防双重收尾）
  const closed = hasClosingFenceAfter(context.state, lineNo)
  const typed = /^[ \t]*```([a-zA-Z0-9+#._-]*)$/.exec(m.text)?.[1] ?? ''
  const options = LANGS.filter(
    (l) =>
      !typed ||
      l.label.startsWith(typed) ||
      (l.aliases?.some((a) => a.startsWith(typed)) ?? false)
  ).map((l): Completion => ({
    label: l.label,
    type: 'text',
    apply: closed
      ? l.label
      : (view: EditorView): void => {
          closeFence(view, l.label)
        }
  }))
  if (options.length === 0) return null
  return {
    from: context.pos - typed.length,
    options,
    validFor: /^[a-zA-Z0-9+#._-]*$/
  }
}

/** 手敲完语言（不走候选列表）按 Enter：新块自动补收尾 ``` 并聚焦块内；
 *  已有收尾围栏的行（改语言）不接管，交回默认换行 */
const enterCloseFence = (view: EditorView): boolean => {
  if (!view.state.selection.main.empty) return false
  // 补全弹层开着时让给 acceptCompletion：候选的 apply 自带「选中即收尾」
  if (completionStatus(view.state) === 'active') return false
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const lang = fenceLine(line.text)
  if (lang === null || !opensNewBlock(view.state, line.number)) return false
  if (hasClosingFenceAfter(view.state, line.number)) return false
  closeFence(view, lang)
  return true
}

/** 补全装配：fence 语言源 + 调用方追加的源（emoji 短代码等），override 单数组生效 */
export function fenceCompletion(...extra: CompletionSource[]): Extension[] {
  return [
    // override 替换默认补全源（原 autocompletion() 无其它来源，markdown 语言无内置补全）
    autocompletion({ override: [fenceLangSource, ...extra] }),
    // 高优先级 Enter：在 ```开栏 行上抢先于默认换行
    Prec.high(keymap.of([{ key: 'Enter', run: enterCloseFence }]))
  ]
}
