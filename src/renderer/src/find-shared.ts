/**
 * 三处查找（即显 pm-find / 源码 CM6 / 预览 DOM 高亮）共享的查询模型与正则构造。
 */

export interface FindQuery {
  text: string
  caseSensitive: boolean
  regexp: boolean
  /** 全字匹配（仅字面模式；正则模式下由用户自写 \b） */
  wholeWord: boolean
}

/** 回显给查找条的状态摘要 */
export interface FindStatus {
  open: boolean
  count: number
  /** 0 基；-1 = 无活动项 */
  active: number
  error: boolean
}

export function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构造全局匹配正则；非法正则返回 null（查找条红框提示）。
 * 字面模式转义 + 可选 \b 全字包裹；正则模式原样（忽略 wholeWord）。
 */
export function buildRegex(q: FindQuery): RegExp | null {
  try {
    if (q.regexp) return new RegExp(q.text, q.caseSensitive ? 'g' : 'gi')
    const body = escapeRe(q.text)
    return new RegExp(q.wholeWord ? `\\b(?:${body})\\b` : body, q.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

/** 正则替换展开（$1 等分组引用）；字面模式原样返回 */
export function expandReplacement(q: FindQuery, matchedText: string, replacement: string): string {
  if (!q.regexp) return replacement
  try {
    return matchedText.replace(new RegExp(q.text, q.caseSensitive ? '' : 'i'), replacement)
  } catch {
    return replacement
  }
}
