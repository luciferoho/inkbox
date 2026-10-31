import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { t } from '@/i18n'
import { applyCopiedFeedback, COPY_ICON, writeClipboard } from './code-copy'
import { FENCE_LANGS } from './cm-fence-completion'

/**
 * 即显模式代码块 chrome：为每个 code_block 节点上方插入
 * 「语言标签 + 复制按钮」widget 栏（与预览管线观感一致）。
 * - widget 内容不可编辑；按钮 mousedown 阻止默认，避免 PM 光标跳动
 * - 点击复制读相邻 pre 的文本（widget 与 pre 同级相邻）
 * - 语言标签可点击：原地换成输入框 + 语言补全菜单（5.2），Enter/点选提交
 *   （setNodeMarkup 改 language 属性；mermaid 切换由节点视图重建自动重绘），
 *   Esc/失焦取消不落盘
 * - decorations 随每次事务重建：语言编辑/节点增删即时反映
 * - 行号（七.2）已按用户要求移除（对齐 Typora，2026-10-31）
 */
interface ViewRef {
  view: EditorView | null
}

export function createCodeblockChromePlugin(): Plugin {
  const ref: ViewRef = { view: null }
  return new Plugin({
    view: (view) => {
      ref.view = view
      return { destroy: () => (ref.view = null) }
    },
    props: {
      decorations: (state: EditorState) => buildDecorations(state, ref)
    }
  })
}

/** 插入命令插入新代码块后调用：按 pos 找到块的 chrome 语言标签，
 *  直接进入语言编辑态（用户插入后第一件事是选语言）。
 *  必须在 dispatch 完成后调用（依赖块 DOM 已挂载） */
export function openLangEditorFor(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'code_block' || String(node.attrs.language ?? '')) return
  const blockDom = view.nodeDOM(pos)
  if (!(blockDom instanceof HTMLElement)) return
  const bar = blockDom.previousElementSibling
  const langEl = bar instanceof HTMLElement ? bar.querySelector('.md-code-lang') : null
  if (langEl instanceof HTMLElement) startLangEdit(langEl, node, pos, { view })
}

function buildDecorations(state: EditorState, ref: ViewRef): DecorationSet {
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
    langEl.title = t('code.editLang')
    langEl.addEventListener('mousedown', (e) => {
      e.preventDefault()
      startLangEdit(langEl, node, pos, ref)
    })

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
    return false // 不下钻代码块内容
  })
  return DecorationSet.create(state.doc, decos)
}

/** 语言标签 → 原地输入框 + 补全菜单。编辑期间不发 PM 事务（widget 不会被重建）；
 *  Enter/点选候选拼提交，Esc/失焦取消。 */
function startLangEdit(langEl: HTMLElement, node: PMNode, pos: number, ref: ViewRef): void {
  const view = ref.view
  const current = view?.state.doc.nodeAt(pos)
  if (!view || !current || current.type.name !== 'code_block') return
  const original = langEl.textContent
  langEl.textContent = ''
  langEl.classList.add('is-editing')

  const input = document.createElement('input')
  input.className = 'md-code-lang-input'
  input.spellcheck = false
  input.value = String(node.attrs.language ?? '')

  const menu = document.createElement('div')
  menu.className = 'md-code-lang-menu'
  langEl.append(input, menu)

  let items: { label: string; el: HTMLButtonElement }[] = []
  let active = -1

  const cleanup = (): void => {
    langEl.classList.remove('is-editing')
    langEl.textContent = original
  }

  const commit = (raw: string): void => {
    const value = raw.trim().toLowerCase()
    cleanup()
    // 位置有效性兜底：编辑期间文档不应变，但防御 pos 漂移
    if (!view.state.doc.nodeAt(pos)) return
    if (value === String(node.attrs.language ?? '')) return
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: value })
    // 提交后光标落块内首行（用户接着写代码）
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))))
    view.dispatch(tr)
    view.focus()
  }

  const renderMenu = (): void => {
    const typed = input.value.trim().toLowerCase()
    const hits = FENCE_LANGS.filter(
      (l) =>
        !typed ||
        l.label.startsWith(typed) ||
        (l.aliases?.some((a) => a.startsWith(typed)) ?? false)
    ).slice(0, 8)
    menu.textContent = ''
    items = hits.map((l) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'md-code-lang-item'
      b.textContent = l.label
      b.addEventListener('mousedown', (e) => {
        e.preventDefault()
        commit(l.label)
      })
      menu.appendChild(b)
      return { label: l.label, el: b }
    })
    active = -1
    menu.style.display = items.length ? '' : 'none'
  }

  input.addEventListener('mousedown', (e) => e.stopPropagation())
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      // 有高亮项用高亮；否则取过滤后的首项（输入 py → python），列表为空才用原文（自定义语言）
      const pick = active >= 0 && items[active] ? items[active]!.label : items[0]?.label ?? input.value
      commit(pick)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // 取消：标签还原并把焦点交回代码块（用户接着写代码）
      cleanup()
      view.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!items.length) return
      active =
        e.key === 'ArrowDown'
          ? (active + 1) % items.length
          : (active - 1 + items.length) % items.length
      items.forEach((it, i) => it.el.classList.toggle('is-active', i === active))
      items[active]!.el.scrollIntoView({ block: 'nearest' })
    }
  })
  input.addEventListener('input', renderMenu)
  input.addEventListener('blur', () => cleanup())
  renderMenu()
  // 轮询聚焦：插入命令路径不回焦 PM host（PM 持焦时 input 会被选区重占顶掉），
  // 单次聚焦仍可能被迁移中的焦点事件盖掉，持续尝试直到真正持焦
  const focusInput = (tries: number): void => {
    if (!input.isConnected) return
    input.focus()
    if (document.activeElement === input) {
      input.select()
      return
    }
    if (tries > 0) window.setTimeout(() => focusInput(tries - 1), 40)
  }
  focusInput(8)
}
