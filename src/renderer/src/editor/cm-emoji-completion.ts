import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
// 词表本体（名字 → 字符的平面对象）；包主入口的 `full` 导出是 markdown-it 插件函数
import emojiDefs from 'markdown-it-emoji/lib/data/full.mjs'

/**
 * emoji 短代码补全（ROADMAP 2.11，源码/双栏 CodeMirror 侧）：
 * 空白或行首后敲 `:名称前缀` 弹候选，选中插入 emoji 字符——
 * 与预览（markdown-it-emoji）/即显（remark-gemoji）管线的
 * 「解析期替换为字符」行为一致，词表同源（markdown-it-emoji full）。
 */

/** 词表（名字 → 字符）：即显侧补全（pm-emoji-completion）复用同一份，避免两套词表漂移 */
export const EMOJI_DEFS: Record<string, string> = emojiDefs as Record<string, string>

/** 系统字体能否渲染该字符：canvas 缺字检测（与未分配码位 U+10FFFE 的缺字方框
 *  逐像素比较，相同或全透明即画不出——覆盖旗帜、Emoji 13+ 新表情等，比维护
 *  码位版本表可靠）。结果缓存；选择器网格与 `:短代码` 补全候选共用同一份，
 *  提示框里不再出现渲染不出的表情（用户实测截图一） */
function supportedChar(ch: string, ctx: CanvasRenderingContext2D, tofu: Uint8ClampedArray): boolean {
  ctx.clearRect(0, 0, 32, 32)
  ctx.fillText(ch, 0, 0)
  const cur = ctx.getImageData(0, 0, 32, 32).data
  let diff = 0
  let ink = 0
  for (let i = 0; i < cur.length; i += 4) {
    diff += Math.abs(cur[i] - tofu[i]) + Math.abs(cur[i + 1] - tofu[i + 1]) + Math.abs(cur[i + 2] - tofu[i + 2]) + Math.abs(cur[i + 3] - tofu[i + 3])
    ink += cur[i + 3]
  }
  if (ink === 0) return false
  return diff > 0
}

let supportedCache: Set<string> | null = null

/** 可渲染字符集合（惰性建表并缓存） */
export function supportedEmojiChars(): Set<string> {
  if (supportedCache) return supportedCache
  const all = Object.entries(EMOJI_DEFS)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return (supportedCache = new Set(all.map(([, ch]) => String(ch))))
    ctx.font = '28px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
    ctx.textBaseline = 'top'
    ctx.clearRect(0, 0, 32, 32)
    ctx.fillText('\u{10FFFE}', 0, 0)
    const tofu = ctx.getImageData(0, 0, 32, 32).data.slice()
    const set = new Set<string>()
    for (const [, ch] of all) {
      const c = String(ch)
      if (supportedChar(c, ctx, tofu)) set.add(c)
    }
    return (supportedCache = set)
  } catch {
    return (supportedCache = new Set(all.map(([, ch]) => String(ch))))
  }
}

/** 短代码模糊匹配：输入 `:eyes` 也要命中 `:heart_eyes:`（子串分词匹配）。
 *  名字按 `_`/`-` 拆词，查询每个 token 都须命中；前缀命中排前、名字短的优先。
 *  只返回系统能渲染的字符（提示框不出现方框候选） */
export function matchEmojiNames(query: string): { name: string; char: string }[] {
  const q = query.toLowerCase().replace(/^:+|:+$/g, '')
  const tokens = q.split(/[\s_\-]+/).filter(Boolean)
  if (!tokens.length) return []
  const supported = supportedEmojiChars()
  const out: { name: string; char: string; rank: number }[] = []
  for (const [name, ch] of Object.entries(emojiDefs as Record<string, string>)) {
    const c = String(ch)
    if (!supported.has(c)) continue
    const lower = name.toLowerCase()
    if (!tokens.every((tk) => lower.includes(tk))) continue
    // 0 = 全名前缀，1 = 首 token 前缀，2 = 仅子串
    const rank = lower.startsWith(q) ? 0 : lower.split('_')[0].startsWith(tokens[0]) ? 1 : 2
    out.push({ name, char: c, rank })
  }
  out.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name))
  return out.map(({ name, char }) => ({ name, char }))
}

/** emoji 短代码补全源（导出供 SourceEditor 与测试直接调用）。
 *  行首/空白/emoji 字符后敲 `:名称` 弹候选（模糊匹配），选中即替换为 emoji 字符 */
export const emojiShortcodeSource = (context: CompletionContext): CompletionResult | null => {
  const m = context.matchBefore(/(?:^|\s|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*):([a-zA-Z0-9_+-]*)$/u)
  if (!m) return null
  const typed = (/[a-zA-Z0-9_+-]*$/.exec(m.text)?.[0] ?? '').toLowerCase()
  const from = context.pos - typed.length - 1 // 含起始冒号，选中后整段替换为字符
  const names = typed ? matchEmojiNames(typed) : []
  const options: Completion[] = names.slice(0, 200).map((h) => ({
    label: `:${h.name}:`,
    detail: h.char,
    apply: h.char,
    type: 'text' as const
  }))
  if (options.length === 0) return null
  return {
    from,
    // 已按模糊匹配排序；关掉 CM 默认的二次过滤（它按 from..pos 文本匹配 label，
    // 对 `eyes` → `:heart_eyes:` 这类子串命中会再次滤掉）
    filter: false,
    options
  }
}
