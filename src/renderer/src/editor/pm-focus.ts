import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { useUiStore } from '@/stores/ui'

/**
 * 即显侧专注/打字机模式（ROADMAP 1.8）：与源码侧 cm-focus.ts 对齐的开关
 * （ui.focusMode / ui.typewriterMode，F8/F9 与状态栏按钮共用）。
 * - 专注：装饰器把当前顶层块之外的全部内容淡显（Typora 语义）；
 * - 打字机：光标移动/输入后把光标行钉在面板垂直中部（即时跟随，不平滑）。
 * 开关切换不产生事务，由 WysiwygEditor watch 派发空事务触发重算。
 */

export function createWysiwygFocusPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey<DecorationSet>('luci-wysiwyg-focus'),
    props: {
      decorations: (state: EditorState) => {
        if (!useUiStore().focusMode) return DecorationSet.empty
        const { $from } = state.selection
        if ($from.depth < 1) return DecorationSet.empty
        const curPos = $from.before(1)
        const decos: Decoration[] = []
        state.doc.forEach((node, offset) => {
          if (offset !== curPos) {
            decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'pm-dim' }))
          }
        })
        return DecorationSet.create(state.doc, decos)
      }
    }
  })
}

export function createWysiwygTypewriterPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey<unknown>('luci-wysiwyg-typewriter'),
    view: () => ({
      update: (view: EditorView, prevState: EditorState) => {
        if (!useUiStore().typewriterMode) return
        if (view.state.selection === prevState.selection) return
        const sel = view.state.selection
        const pos = sel.head
        let coords: { top: number; bottom: number; left: number; right: number } | null = null
        try {
          coords = view.coordsAtPos(pos)
        } catch {
          return
        }
        const host = view.dom.closest('.wysiwyg-host') as HTMLElement | null
        if (!host || !coords) return
        const hostRect = host.getBoundingClientRect()
        const target = coords.top - hostRect.top + host.scrollTop - host.clientHeight / 2
        host.scrollTo({ top: Math.max(0, target) })
      }
    })
  })
}
