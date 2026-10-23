import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as PmNode } from '@milkdown/kit/prose/model'

/* ---------- GitHub / Typora 1.15+ 警告块（即显侧装饰器） ----------
   `> [!NOTE]` 等标记的 blockquote 加 .md-alert 类、隐藏标记文本、插入标题胶囊，
   与预览侧 markdown.ts 的 DOM 约定一致（主题按 .md-alert 上色，phycat 全套）。
   标记文本保留在文档里（装饰器隐藏），删除/编辑标记即恢复普通引用块。 */

const ALERT_ICONS: Record<string, string> = {
  note: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  tip: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.75.75 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z',
  important:
    'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 .75-.75ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  warning:
    'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.083 15H1.917a1.75 1.75 0 0 1-1.542-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  caution:
    'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25a.749.749 0 0 1-.53.22H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 3.564a.749.749 0 1 0-1.06 1.06L5.939 7 4.25 8.656a.749.749 0 1 0 1.06 1.06L7 9.061l1.656 1.655a.749.749 0 1 0 1.06-1.06L8.061 8l1.655-1.656a.749.749 0 1 0-1.06-1.06L7 6.939Z'
}

const ALERT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
}

const ALERT_RE = /^\s*\[!(note|tip|important|warning|caution)\][ \t]*/i

function alertPill(type: string): HTMLElement {
  const pill = document.createElement('span')
  pill.className = 'md-alert-text-container'
  pill.setAttribute('contenteditable', 'false')
  pill.innerHTML =
    `<span class="md-alert-text md-alert-text-${type}">` +
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${ALERT_ICONS[type] ?? ''}"/></svg>` +
    `${ALERT_TITLES[type] ?? type}</span>`
  return pill
}

function collect(doc: PmNode): Decoration[] {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return true
    const first = node.firstChild
    if (!first || first.type.name !== 'paragraph') return true
    const m = ALERT_RE.exec(first.textContent)
    if (!m) return true
    const type = m[1].toLowerCase()
    out.push(Decoration.node(pos, pos + node.nodeSize, { class: `md-alert md-alert-${type}` }))
    // blockquote 开 1 + 段落开 1 = 首段文本起点
    const contentStart = pos + 2
    out.push(Decoration.inline(contentStart, contentStart + m[0].length, { style: 'display:none' }))
    out.push(Decoration.widget(contentStart + m[0].length, () => alertPill(type), { side: -1 }))
    return false
  })
  return out
}

/** 即显警告块装饰器：随文档变化重算（输入 [!NOTE] 即成块，删掉即还原） */
export function createGhAlertsPlugin(): Plugin<DecorationSet | null> {
  const key = new PluginKey<DecorationSet | null>('luci-gh-alerts')
  return new Plugin<DecorationSet | null>({
    key,
    state: {
      init: (_, state) => DecorationSet.create(state.doc, collect(state.doc)),
      apply: (tr, prev) =>
        tr.docChanged || tr.selectionSet ? DecorationSet.create(tr.doc, collect(tr.doc)) : prev
    },
    props: {
      decorations: (state) => key.getState(state)
    }
  })
}
