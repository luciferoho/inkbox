import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
// 词表本体（名字 → 字符的平面对象）；包主入口的 `full` 导出是 markdown-it 插件函数
import emojiDefs from 'markdown-it-emoji/lib/data/full.mjs'

/**
 * emoji 短代码补全（ROADMAP 2.11，源码/双栏 CodeMirror 侧）：
 * 空白或行首后敲 `:名称前缀` 弹候选，选中插入 emoji 字符——
 * 与预览（markdown-it-emoji）/即显（remark-gemoji）管线的
 * 「解析期替换为字符」行为一致，词表同源（markdown-it-emoji full）。
 */

const OPTIONS: Completion[] = Object.entries(emojiDefs).map(([name, char]) => ({
  label: `:${name}:`,
  detail: char,
  apply: char,
  type: 'text'
}))

/** emoji 短代码补全源（导出供 SourceEditor 与测试直接调用） */
export const emojiShortcodeSource = (context: CompletionContext): CompletionResult | null => {
  const m = context.matchBefore(/(?:^|\s):([a-zA-Z0-9_+-]*)$/)
  if (!m) return null
  const typed = (/[a-zA-Z0-9_+-]*$/.exec(m.text)?.[0] ?? '').toLowerCase()
  const from = context.pos - typed.length - 1 // 含起始冒号，选中后整段替换为字符
  const needle = typed ? `:${typed}` : null
  const options = needle
    ? OPTIONS.filter((o) => o.label.toLowerCase().includes(needle)).map((o) => ({
        ...o,
        // boost 影响 CM 内部排序：完整前缀（:smile: 之于 :smile）优先于更长变体
        boost: o.label.toLowerCase() === needle + ':' ? 100 : o.label.toLowerCase().startsWith(needle) ? 50 : 0,
      }))
    : OPTIONS
  if (options.length === 0) return null
  return {
    from,
    options: options.slice(0, 500),
    validFor: /^[a-zA-Z0-9_+-]*$/
  }
}
