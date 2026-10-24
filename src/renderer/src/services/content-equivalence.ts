/**
 * 内容等价判定（打开即未保存问题的根治）。
 *
 * 背景：即显（Milkdown/remark）挂载与编辑会把序列化风格差异回推进 store
 * （列表符号 `*`→`-`、表格列宽补空格、围栏信息串空格、缩进抹平、链接
 * `./` 前缀、转义改写……）。逐字或逐规则归一（旧 canonicalizeContent）
 * 永远追不上新写法，任何一种漏网写法都会让"打开即未保存"复发。
 *
 * 根治：把两边文本都过与即显完全一致的 remark 解析管线
 * （插件序列见 editor/wysiwyg-remark-pipeline.ts，单一来源共享），
 * 对解析出的 mdast 做归一化后深比较——**渲染等价 ⇒ 树等价 ⇒ 不算编辑**。
 * 风格差异在解析阶段就消失，不再依赖枚举。
 *
 * 已知的有意豁免（对称剥离，不是 bug）：
 * - 仅含硬换行的段落 / 独占一行的 `<br>`（行内转 break 后同理、块级 html 原样）：
 *   PM 无法表达（挂载即丢弃，序列化被剥离），磁盘侧同步剥离，两侧都不参与比较。
 * - 链接/图片目标的 `./` 前缀：管线回推时会补/去，渲染不变。
 * - 表格对齐 `null ≡ 'left'`：无冒号与 `:---` 渲染一致。
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { canonicalizeContent } from '@/services/markdown'
import { wysiwygRemarkPlugins } from '@/editor/wysiwyg-remark-pipeline'

interface MdastNode {
  type?: string
  value?: unknown
  url?: unknown
  alt?: unknown
  title?: unknown
  lang?: unknown
  meta?: unknown
  depth?: number
  ordered?: boolean
  start?: number | null
  checked?: boolean | null
  align?: (string | null)[] | null
  identifier?: unknown
  label?: unknown
  tag?: unknown
  children?: MdastNode[]
}

/** 与即显解析管线一致的处理器（构建一次复用；unified 处理器不可重入并发，
 *  渲染层单线程顺序调用无此问题） */
const processor = (() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any = unified().use(remarkParse).use(remarkGfm)
  for (const plug of wysiwygRemarkPlugins) p = p.use(plug.plugin, plug.options)
  return p
})()

/** 链接/图片目标：管线回推会补 `./` 前缀，渲染不变，比较前剥掉 */
function normUrl(url: unknown): string {
  return String(url ?? '').replace(/^\.\//, '')
}

/** 表格对齐：无冒号（null）与 `:---`（left）渲染一致 */
function normAlign(align: (string | null)[] | null | undefined): string[] | null {
  if (!align) return null
  return align.map((a) => (a == null ? 'left' : a))
}

/** 独占一行的 `<br>`：行内的已由 mergeHtmlSpans 转 break；块级的 PM 表达不了
 *  （挂载即丢弃，序列化不留痕）——mergeHtmlSpans 在任意层级把 br 的 html 节点
 *  转成 break，块级容器（root/blockquote/listItem 等）里出现的 break 全是这类
 *  伪影（mdast 里 break 只合法存在于行内内容中），连同原始 html 节点一起剥离 */
const BR_HTML_RE = /^<br\s*\/?>$/i

/** break 合法存在的行内容器；其余容器里的 break 均为 br 转换伪影 */
const INLINE_PARENTS = new Set(['paragraph', 'heading', 'tableCell'])

function normChildren(parent: MdastNode, nodes: MdastNode[]): MdastNode[] {
  const dropBreaks = !INLINE_PARENTS.has(parent.type ?? '')
  return nodes.filter(
    (c) =>
      !(c.type === 'html' && BR_HTML_RE.test(String(c.value ?? '').trim())) &&
      !(dropBreaks && c.type === 'break')
  )
}

/** mdast → 可比较的普通结构（键序确定，可直接 JSON.stringify 比对）。
 *  丢弃 position；仅保留影响渲染的属性 */
function normalizeNode(n: MdastNode): unknown {
  const simple = (v: unknown): unknown => String(v ?? '')
  const base: Record<string, unknown> = { t: n.type }
  switch (n.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
    case 'inlineMath':
    case 'math':
    case 'yaml':
      base.v = simple(n.value)
      if (n.type === 'code') {
        base.lang = simple(n.lang)
        base.meta = simple(n.meta)
      }
      break
    case 'html':
      // 非白名单标签保持字面（原子）；`<br>` 系已由管线转 break，不会到这里
      base.v = simple(n.value)
      break
    case 'break':
      break
    case 'image':
      base.url = normUrl(n.url)
      base.alt = simple(n.alt)
      base.title = simple(n.title)
      break
    case 'link':
      base.url = normUrl(n.url)
      base.title = simple(n.title)
      break
    case 'heading':
      base.depth = n.depth
      break
    case 'list':
      base.ordered = !!n.ordered
      base.start = n.ordered ? (n.start ?? 1) : null
      break
    case 'listItem':
      base.checked = n.checked ?? null
      break
    case 'table':
      base.align = normAlign(n.align)
      break
    case 'footnoteReference':
      base.id = simple(n.identifier)
      break
    case 'footnoteDefinition':
      base.id = simple(n.identifier)
      break
    case 'toc':
      break
    default:
      // 自定义节点（markHighlight/htmlSpan 等）与其余内置节点：类型 + 全部
      // 标量子段 + 递归子节点已足够区分
      for (const k of ['value', 'tag', 'label', 'identifier'] as const) {
        if (n[k] !== undefined && n[k] !== null) base[k] = simple(n[k])
      }
      if (n.depth !== undefined) base.depth = n.depth
  }
  if (n.children) {
    const kids = normChildren(n, n.children)
    if (n.type === 'paragraph') {
      // 仅含硬换行（或剥掉 br 后为空）的段落：PM 无法表达（序列化时整段被丢弃），
      // 磁盘侧同步剥离，两侧对称，不参与等价判定
      if (!kids.some((c) => c.type !== 'break')) return null
    }
    const mapped = kids.map(normalizeNode).filter((x) => x !== null)
    if (mapped.length > 0) base.c = mapped
  }
  return base
}

/** 结构比较的成本上限（字符数）：超过则只走词法归一快速通道。
 *  全量 remark 解析 1MB 级文档要秒级，不能落在每次内容回推的路径上——
 *  超大文档保守返回不等价（可能对极端大文档误标脏，但绝不冻结 UI） */
const STRUCTURAL_MAX_CHARS = 200_000

/**
 * 内容等价（分层）：
 * 1. 精确相等 / 仅换行风格差异 → 等价（零成本）；
 * 2. 词法归一相等（canonicalizeContent，O(n) 行处理）→ 等价——
 *    编辑中的逐键回推两侧都出自同一序列化器，风格差异可被词法覆盖，
 *    键入路径在此即返回，不触发解析；
 * 3. 词法不等的（挂载回推、跨序列化器比较）→ mdast 结构比较兜底，
 *    渲染等价即等价，风格写法差异在解析阶段消失。
 */
export function contentEquivalent(a: string, b: string): boolean {
  if (a === b) return true
  // milkdown 序列化恒为 LF，磁盘可能是 CRLF——换行差异先归一
  const na = a.replace(/\r\n?/g, '\n')
  const nb = b.replace(/\r\n?/g, '\n')
  if (na === nb) return true
  try {
    if (canonicalizeContent(na) === canonicalizeContent(nb)) return true
  } catch {
    /* 词法归一异常不致命，继续走结构比较 */
  }
  if (na.length > STRUCTURAL_MAX_CHARS || nb.length > STRUCTURAL_MAX_CHARS) return false
  try {
    // 必须走 runSync：splitInlineMarks/mergeHtmlSpans 等是 remark transformer，
    // 只 parse 不 run 的话树里没有这些改写，与真实管线不对称
    const ta = JSON.stringify(normalizeNode(processor.runSync(processor.parse(na)) as MdastNode))
    const tb = JSON.stringify(normalizeNode(processor.runSync(processor.parse(nb)) as MdastNode))
    return ta === tb
  } catch {
    return false
  }
}
