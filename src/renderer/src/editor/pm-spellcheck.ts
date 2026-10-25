import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { useUiStore } from '@/stores/ui'
import { ensureSpellEngine, spellEngineReady, findMisspells } from '@/services/spellcheck'

/**
 * 即显拼写装饰（4.2 自研引擎）：段落级文本块内的错词加 inline 装饰
 * （红波浪线）。代码块/数学/mermaid/YAML/TOC 不检查。装饰直接由
 * props.decorations(state) 动态构建（词查询有 Map 缓存，重扫成本低）；
 * 引擎懒加载，就绪后派发带 meta 的事务触发全量重扫。
 */

export const spellcheckKey = new PluginKey<DecorationSet>('inkbox-spellcheck')

/** 文本块不参与检查的类型 */
const SKIP = new Set(['code_block', 'math', 'yaml', 'mermaid', 'toc', 'html'])

/** 行内不参与检查的节点（行内码/公式/图片/脚注角标） */
const SKIP_INLINE = new Set(['inlineCode', 'inlineMath', 'image', 'footnote_reference'])

function buildDecos(state: EditorState): DecorationSet {
  const ui = useUiStore()
  if (!ui.editorPrefs.spellcheck || !spellEngineReady()) return DecorationSet.empty
  const decos: Decoration[] = []
  state.doc.descendants((node: PMNode, pos: number) => {
    if (SKIP.has(node.type.name)) return false
    if (!node.isTextblock) return true
    // 行内结构感知：行内码/公式等占位为空字符（词正则不命中），
    // 保证 findMisspells 的偏移与块内文本一致
    let plain = ''
    node.children.forEach((child) => {
      if (child.isText) {
        plain += child.text ?? ''
      } else if (SKIP_INLINE.has(child.type.name)) {
        plain += ' '.repeat(child.nodeSize)
      } else if (child.isTextblock || !child.isLeaf) {
        plain += child.textContent
      } else {
        plain += ' '.repeat(child.nodeSize)
      }
    })
    if (!plain.trim()) return false
    const hits = findMisspells(plain)
    for (const h of hits) {
      decos.push(Decoration.inline(pos + 1 + h.start, pos + 1 + h.end, { class: 'spell-err' }))
    }
    return false
  })
  return DecorationSet.create(state.doc, decos)
}

export function createSpellcheckPlugin(): Plugin {
  return new Plugin({
    key: spellcheckKey,
    props: {
      decorations: (state) => buildDecos(state)
    },
    view: (view) => {
      // 引擎懒加载：就绪后派发带 meta 的空事务触发全量重扫（首次开启时波浪线立现）
      void ensureSpellEngine().then((ready) => {
        if (!ready) return
        if (view.state.doc.content.size > 0) {
          view.dispatch(view.state.tr.setMeta('spellcheck-rescan', true))
        }
      })
      return {
        destroy: () => undefined
      }
    }
  })
}
