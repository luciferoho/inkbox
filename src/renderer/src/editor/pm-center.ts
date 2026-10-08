import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'

/**
 * 即显模式 GitHub 居中块（显示层增强，不改动文档）：
 * - 识别独占一段的 `<div align="center">` 与 `</div>`（README 最常见的 HTML 写法）
 * - 标签段落隐藏（.md-center-tag），两者之间的顶层块加居中样式（.md-center）
 * - 纯 Decoration 实现：文档 JSON 与 markdown 序列化完全不受影响，
 *   保存时标签原样保留（与 markdown.ts 管线的白名单行为互补）
 */


export const centerKey = new PluginKey<DecorationSet>('luci-center')

/**
 * 段落是否为居中块标签行。两种来源：
 * - Milkdown 把独立成行的标签解析为内联 html 节点（原始 HTML 在 attrs.value，textContent 为空）
 * - 兜底：普通文本段落（textContent 匹配）
 */
function paraTagKind(node: PMNode): 'open' | 'close' | null {
  if (!node.isTextblock) return null
  const kids: PMNode[] = []
  node.forEach((k) => kids.push(k))
  if (kids.length === 1 && kids[0].type.name === 'html') {
    const raw = String(kids[0].attrs.value ?? '').trim()
    if (/^<div align="center">$/i.test(raw)) return 'open'
    if (/^<\/div>$/i.test(raw)) return 'close'
    return null
  }
  const t = node.textContent.trim()
  if (/^<div align="center">$/i.test(t)) return 'open'
  if (/^<\/div>$/i.test(t)) return 'close'
  return null
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  let openEnd: number | null = null // 开标签段之后的内容起点

  doc.forEach((node, offset) => {
    const kind = paraTagKind(node)
    if (openEnd === null) {
      if (kind === 'open') {
        decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'md-center-tag' }))
        openEnd = offset + node.nodeSize
      }
      return
    }
    if (kind === 'close') {
      decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'md-center-tag' }))
      openEnd = null
      return
    }
    decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'md-center' }))
  })

  return DecorationSet.create(doc, decos)
}

/** 每次编辑器挂载都要全新实例（PM 插件状态按实例存放） */
export function createCenterPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: centerKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old)
    },
    props: {
      decorations: (state) => centerKey.getState(state)
    }
  })
}
