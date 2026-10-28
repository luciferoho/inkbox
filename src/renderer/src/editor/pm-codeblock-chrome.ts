import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { t } from '@/i18n'
import { applyCopiedFeedback, COPY_ICON, writeClipboard } from './code-copy'

/**
 * 即显模式代码块 chrome：为每个 code_block 节点上方插入
 * 「语言标签 + 复制按钮」widget 栏（与预览管线观感一致），并在每行行首
 * 放行号 widget（与预览行号观感对齐；mermaid 块整块渲染图表，跳过行号）。
 * - widget 内容不可编辑；按钮 mousedown 阻止默认，避免 PM 光标跳动
 * - 点击复制读相邻 pre 的文本（widget 与 pre 同级相邻）
 * - decorations 随每次事务重建：语言编辑/增删行/节点增删即时反映
 */
export function createCodeblockChromePlugin(): Plugin {
  return new Plugin({
    props: {
      decorations: (state: EditorState) => buildDecorations(state)
    }
  })
}

function buildDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = []
  state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'code_block') return
    const lang = String(node.attrs.language ?? '').toLowerCase()

    const bar = document.createElement('div')
    bar.className = 'md-code-bar'
    bar.contentEditable = 'false'

    const langEl = document.createElement('span')
    langEl.className = 'md-code-lang'
    langEl.textContent = lang

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'md-code-copy'
    btn.innerHTML = COPY_ICON
    btn.title = t('code.copy')
    btn.setAttribute('aria-label', t('code.copy'))
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', () => {
      const pre = bar.nextElementSibling
      // 取 code 源码而非 pre.textContent：mermaid 块的 pre 里混着渲染出的 SVG 文本
      const text =
        pre instanceof HTMLPreElement
          ? (pre.querySelector('code')?.textContent ?? pre.textContent ?? '')
          : ''
      if (!text) return
      void writeClipboard(text).then((ok) => {
        if (ok) applyCopiedFeedback(btn, t('code.copied'), t('code.copy'))
      })
    })

    bar.append(langEl, btn)
    decos.push(
      Decoration.widget(pos, bar, { side: -1, key: `cb-chrome-${pos}`, ignoreSelection: true })
    )
    // 行号 widget：每行行首一个（含空行）；软换行的视觉折行不重复编号（按逻辑行）
    if (lang !== 'mermaid') {
      let cur = pos + 1
      const lines = node.textContent.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const ln = document.createElement('span')
        ln.className = 'pm-code-ln'
        ln.contentEditable = 'false'
        ln.textContent = String(i + 1)
        decos.push(
          Decoration.widget(cur, ln, { key: `cb-ln-${pos}-${i}`, ignoreSelection: true })
        )
        cur += lines[i]!.length + 1
      }
    }
    return false // 不下钻代码块内容
  })
  return DecorationSet.create(state.doc, decos)
}
