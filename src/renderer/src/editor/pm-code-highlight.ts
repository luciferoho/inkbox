import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { hljs } from '@/services/markdown'

/**
 * 即显模式代码块语法高亮：对 code_block 内容用 highlight.js 打 hljs-* 内联
 * 装饰。语言注册表与预览管线共用（services/markdown.ts，含 sql），配色直接
 * 命中全局 .hljs-* 令牌规则（--code-*，亮暗主题自动跟随），与预览观感一致。
 * - 事务后只重建变更范围命中的块，其余装饰按 mapping 平移（大文档不逐键全量重高亮）
 * - hljs 分词结果按「语言+代码」缓存，编辑中的块每键只做一次解析（无命中缓存时）
 */
interface Span {
  start: number
  end: number
  classes: string[]
}

const key = new PluginKey<DecorationSet>('luci-code-hl')
const tokenCache = new Map<string, Span[]>()

/** 把 hljs 的 HTML 产物解析为原文偏移区间（offset 与 code 字符串 1:1，
 *  代码块内容是带真实换行的纯文本）；无 class 的外壳文本自然跳过 */
function parseSpans(value: string): Span[] {
  const host = document.createElement('div')
  host.innerHTML = value
  const spans: Span[] = []
  let idx = 0
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      idx += node.nodeValue?.length ?? 0
      return
    }
    const el = node as HTMLElement
    const start = idx
    node.childNodes.forEach(walk)
    const classes = (el.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((c) => c.startsWith('hljs-'))
    if (classes.length > 0 && idx > start) spans.push({ start, end: idx, classes })
  }
  host.childNodes.forEach(walk)
  return spans
}

function spansFor(lang: string, code: string): Span[] {
  const l = lang.trim().toLowerCase()
  const cacheKey = `${l}\u0000${code}`
  const hit = tokenCache.get(cacheKey)
  if (hit) return hit
  let spans: Span[] = []
  if (l && hljs.getLanguage(l)) {
    try {
      spans = parseSpans(hljs.highlight(code, { language: l, ignoreIllegals: true }).value)
    } catch {
      spans = []
    }
  }
  if (tokenCache.size >= 400) tokenCache.clear()
  tokenCache.set(cacheKey, spans)
  return spans
}

function blockDecorations(node: PMNode, pos: number, head: number | null): Decoration[] {
  const base = pos + 1 // 进入节点内容
  return spansFor(String(node.attrs.language ?? ''), node.textContent)
    .map((s) => Decoration.inline(base + s.start, base + s.end, { class: s.classes.join(' ') }))
    // 光标邻接压制：光标在 token 内部/右端时不给它上装饰——打字把单词补全成
    // 关键字的瞬间，PM 在光标前插入包裹 span，Chromium 会把光标挤到词首（实测
    // 输入 const 跳回 c 前）；光标移开后选区事务触发重建，高亮恢复
    .filter((d) => head === null || !(d.from < head && head <= d.to))
}

function blockDecorationsAll(node: PMNode, pos: number): Decoration[] {
  return blockDecorations(node, pos, null)
}

function buildAll(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') decos.push(...blockDecorationsAll(node, pos))
    return true
  })
  return DecorationSet.create(doc, decos)
}

/** 本次事务的变更范围（新文档坐标；逐步向前映射累计，与 prosemirror 官方范例同法） */
function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = []
  tr.steps.forEach((_step, i) => {
    const map = tr.mapping.maps[i]
    map.forEach((_oldA, _oldB, newA, newB) => {
      for (let j = 0; j < ranges.length; j++) {
        ranges[j] = [map.map(ranges[j][0], -1), map.map(ranges[j][1], 1)]
      }
      ranges.push([newA, newB])
    })
  })
  return ranges
}

export function createCodeHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => buildAll(state.doc),
      apply(tr, prev, _old, newState) {
        if (!tr.docChanged && !tr.selectionSet) return prev
        let decos = prev.map(tr.mapping, tr.doc)
        // 变更范围：doc 变化取变更区间；纯移动光标则取光标所在块（恢复被压制的邻接高亮）
        const ranges: [number, number][] = tr.docChanged
          ? changedRanges(tr)
          : (() => {
              const $head = newState.selection.$from
              for (let d = $head.depth; d >= 0; d--) {
                if ($head.node(d).type.name === 'code_block') return [[$head.before(d), $head.before(d) + 1]]
              }
              return []
            })()
        const head = newState.selection.head
        for (const [f, t] of ranges) {
          // 变更范围扩到相邻边界，命中的代码块整块重建（块被删除时其装饰
          // 塌缩到范围内，同样被 find 清掉，不会留下孤儿高亮）
          const blocks: { node: PMNode; pos: number }[] = []
          newState.doc.nodesBetween(
            Math.max(0, f - 1),
            Math.min(newState.doc.content.size, t + 1),
            (node, pos) => {
              if (node.type.name === 'code_block') blocks.push({ node, pos })
              return true
            }
          )
          if (blocks.length === 0) continue
          const first = blocks[0]
          const last = blocks[blocks.length - 1]
          const fresh: Decoration[] = []
          for (const b of blocks) fresh.push(...blockDecorations(b.node, b.pos, head))
          decos = decos.remove(decos.find(first.pos, last.pos + last.node.nodeSize)).add(newState.doc, fresh)
        }
        return decos
      }
    },
    props: {
      decorations: (state: EditorState) => key.getState(state)
    }
  })
}
