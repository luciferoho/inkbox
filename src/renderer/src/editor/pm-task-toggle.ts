import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

/**
 * 即显任务列表：milkdown 以 list_item.checked 属性携带任务状态但无内置样式/交互。
 * 用 widget 装饰在项首插入原生 checkbox（与预览 .task-item-checkbox 同款样式），
 * 点击切换 checked 属性，序列化随 [ ]/[x] 更新。
 */
export function createTaskTogglePlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (
            node.type.name === 'list_item' &&
            node.attrs.checked !== null &&
            node.attrs.checked !== undefined
          ) {
            const itemPos = pos
            // 复选框放进项内段落的首字符前（内联位置）——放在 li 与段落之间会独占一行
            const firstChild = state.doc.nodeAt(itemPos + 1)
            const widgetPos = firstChild && firstChild.type.name === 'paragraph' ? itemPos + 2 : itemPos + 1
            decorations.push(
              Decoration.widget(widgetPos, () => {
                const input = document.createElement('input')
                input.type = 'checkbox'
                input.className = 'task-item-checkbox'
                input.checked = !!node.attrs.checked
                input.setAttribute('contenteditable', 'false')
                input.addEventListener('mousedown', (e) => e.stopPropagation())
                input.addEventListener('click', (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  toggleChecked(viewHolder.view, itemPos)
                })
                return input
              }, { side: -1 })
            )
          }
          return undefined
        })
        return DecorationSet.create(state.doc, decorations)
      }
    },
    view(editorView) {
      viewHolder.view = editorView
      return {
        destroy: () => {
          viewHolder.view = null
        }
      }
    }
  })
}

/** 插件 view 持有的编辑器引用（widget 闭包里点击时取用） */
const viewHolder: { view: any } = { view: null }

function toggleChecked(view: any, itemPos: number): void {
  if (!view) return
  const $pos = view.state.doc.resolve(itemPos + 1)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'list_item' && node.attrs.checked !== null && node.attrs.checked !== undefined) {
      const tr = view.state.tr.setNodeMarkup($pos.before(d), undefined, {
        ...node.attrs,
        checked: !node.attrs.checked
      })
      view.dispatch(tr)
      return
    }
  }
}
