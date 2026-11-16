import { $prose, $view } from '@milkdown/kit/utils'
import { Plugin, PluginKey, TextSelection, NodeSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { footnoteReferenceSchema } from './wysiwyg-extensions'

/**
 * 即显脚注交互（Typora 语义，2026-10-31 反馈两轮）：
 * - 单击正文角标 sup.footnote-ref → 选中角标（NodeSelection）就地展开
 *   `[^label]` 输入框编辑（Typora：光标进入显示源码）；Ctrl/Cmd+单击 → 跳到
 *   文末定义（滚动+落光标+高亮闪烁）
 * - 定义排版对齐 Typora：行首 `[^id]：` 标记 widget、行尾 ↩ 回跳按钮；
 *   点 ↩ → 跳回正文首个同名引用（滚动+落光标到角标后+高亮闪烁）
 * - 输入框 Enter/失焦提交、Esc 取消；清空后 Backspace 删掉整个引用
 * 解析/序列化走 remark-footnotes（wysiwyg-remark-pipeline），本模块不碰数据层
 */

/** 清理角标文案：去空白/括号/脱字符（identifier 即 label，序列化写 [^label]） */
function sanitizeId(raw: string): string {
  return raw.replace(/[\s[\]^]/g, '')
}

/* ---------- 跳转 ---------- */

function flashEl(el: Node | null): void {
  if (!(el instanceof HTMLElement)) return
  el.classList.remove('footnote-flash')
  // 强制重启动画（同一元素连续跳转时）
  void el.offsetWidth
  el.classList.add('footnote-flash')
  window.setTimeout(() => el.classList.remove('footnote-flash'), 1000)
}

/** 平滑滚动到 pos 所在元素（大纲跳转同款：host.scrollTo smooth，顶对齐留 80px）。
 *  不用 tr.scrollIntoView——那是瞬时跳变 */
function smoothReveal(view: EditorView, pos: number): void {
  let el: Node | null = view.nodeDOM(pos)
  while (el && !(el instanceof Element)) el = el.parentNode
  const hostEl = view.dom.closest?.('.wysiwyg-host')
  if (!(el instanceof Element) || !(hostEl instanceof HTMLElement)) return
  const top = el.getBoundingClientRect().top - hostEl.getBoundingClientRect().top + hostEl.scrollTop - 80
  hostEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

/** 正文角标 → 定义：落光标到定义首段开头，平滑滚动 + 闪烁 */
function jumpToDef(view: EditorView, id: string): boolean {
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name === 'footnote_definition' && String(node.attrs.identifier ?? '') === id) {
      found = pos
      return false
    }
    return true
  })
  if (found === null) return false
  const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(found + 1), 1))
  view.dispatch(tr)
  smoothReveal(view, found)
  flashEl(view.nodeDOM(found))
  return true
}

/** 定义标记 → 正文首个同名引用：光标落角标后，平滑滚动 + 闪烁 */
function jumpToRef(view: EditorView, id: string): boolean {
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name === 'footnote_reference' && String(node.attrs.identifier ?? '') === id) {
      found = pos
      return false
    }
    return true
  })
  if (found === null) return false
  // 光标落角标之后（inline atom nodeSize=1，found+1 即其后）
  const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(found + 1), 1))
  view.dispatch(tr)
  smoothReveal(view, found)
  flashEl(view.nodeDOM(found))
  return true
}

/* ---------- 定义排版（widget 装饰）：行首 [^id]： 标记 + 行尾 ↩ 回跳 ---------- */

/** 进入 def 首个 textblock 的内容起点；找不到 textblock 返回 null。
 *  inner 从 def 内容起点（pos+1）开始，每下钻一层 +1（越过该层开口 token），
 *  落到 textblock 时 inner 恰是其内容起点（不再多越一层——多越会把标记
 *  排到首字之后，首轮实测踩过） */
function defFirstTextblockPos(node: PMNode, pos: number): number | null {
  let inner = pos + 1
  let cur: PMNode = node
  while (!cur.isTextblock) {
    if (!cur.childCount || !cur.firstChild) return null
    cur = cur.firstChild
    inner += 1
  }
  return inner
}

function buildDefMarkers(state: EditorState): DecorationSet {
  const decos: Decoration[] = []
  state.doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'footnote_definition') return
    const id = String(node.attrs.identifier ?? '')
    const label = id || '?'
    // 行首 [^id]： 标记（不可编辑；Typora 同款标识符形态）
    const markPos = defFirstTextblockPos(node, pos)
    if (markPos !== null) {
      const mark = document.createElement('span')
      mark.className = 'footnote-def-label'
      mark.contentEditable = 'false'
      mark.title = `[^${label}]`
      mark.textContent = `[^${label}]：`
      decos.push(
        Decoration.widget(markPos, mark, {
          side: -1,
          key: `fn-label-${pos}`,
          ignoreSelection: true
        })
      )
    }
    // 行尾 ↩ 回跳：挂在最后一个子块内容终点（再减一是 def 闭合 token 前的
    // 块边界位置，widget 会掉到段落外独占一行——首轮实测踩过）
    const endPos = pos + node.nodeSize - 2
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'footnote-def-back'
    back.title = '跳回正文引用'
    back.textContent = '↩'
    decos.push(
      Decoration.widget(endPos, back, {
        side: 1,
        key: `fn-back-${pos}`,
        ignoreSelection: true
      })
    )
    return false // 不下钻（标记只挂 def 首尾）
  })
  return DecorationSet.create(state.doc, decos)
}

/** 按 DOM 元素反查角标文档位置（同名引用可多个，DOM 比对才唯一） */
function findRefPosByDom(view: EditorView, refEl: HTMLElement): number | null {
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name === 'footnote_reference' && view.nodeDOM(pos) === refEl) {
      found = pos
      return false
    }
    return true
  })
  return found
}

/* ---------- 悬浮提示（Typora 语义）：非编辑态悬浮角标 → 显示定义内容 ---------- */

function ensureTipEl(): HTMLElement {
  const existing = document.querySelector('.footnote-tip')
  if (existing instanceof HTMLElement) return existing
  const tip = document.createElement('div')
  tip.className = 'footnote-tip'
  document.body.appendChild(tip)
  return tip
}

/** 定义内容纯文本（多块以换行拼接）；无匹配返回空串 */
function defTextById(view: EditorView, id: string): string {
  let text = ''
  view.state.doc.descendants((node) => {
    if (text) return false
    if (node.type.name === 'footnote_definition' && String(node.attrs.identifier ?? '') === id) {
      const parts: string[] = []
      node.forEach((b) => parts.push(b.textContent))
      text = parts.join('\n')
      return false
    }
    return true
  })
  return text
}

/** 点击交互 + 定义标记装饰 + 悬浮提示 */
export const createFootnoteJumpPlugin = $prose(() => {
  let showTimer = 0
  const tip = ensureTipEl()

  const hideTip = (): void => {
    window.clearTimeout(showTimer)
    showTimer = 0
    tip.style.display = 'none'
  }

  const showTip = (supEl: HTMLElement, text: string): void => {
    if (!text) return
    tip.textContent = text
    tip.style.display = 'block'
    tip.style.left = '0px'
    tip.style.top = '0px'
    const r = supEl.getBoundingClientRect()
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    const left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8)
    let top = r.bottom + 6
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 6)
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
  }

  const onOver = (e: MouseEvent): void => {
    const supEl = (e.target as HTMLElement | null)?.closest?.('sup.footnote-ref') as HTMLElement | null
    if (!supEl) {
      // 移出角标（含移到提示框本身——纯展示穿透）即收起
      hideTip()
      return
    }
    // 编辑态（源码输入框已展开）不弹提示
    if (supEl.classList.contains('footnote-ref--editing')) {
      hideTip()
      return
    }
    const view = currentView
    const id = supEl.dataset.id ?? ''
    if (!view || !id) return
    const text = defTextById(view, id)
    if (!text) return
    window.clearTimeout(showTimer)
    showTimer = window.setTimeout(() => showTip(supEl, text), 150)
  }

  const onOut = (e: MouseEvent): void => {
    const supEl = (e.target as HTMLElement | null)?.closest?.('sup.footnote-ref')
    const related = e.relatedTarget as Node | null
    if (supEl && (!related || !supEl.contains(related))) hideTip()
  }

  return new Plugin({
    key: new PluginKey<unknown>('luci-footnote-jump'),
    props: {
      handleClick: (view, _pos, event) => {
        hideTip()
        const target = event.target as HTMLElement | null
        if (!target) return false
        const refEl = target.closest?.('sup.footnote-ref') as HTMLElement | null
        if (refEl) {
          event.preventDefault()
          // Typora 语义：Ctrl/Cmd+单击跳定义；普通单击 = 选中角标就地展开编辑
          if (event.ctrlKey || event.metaKey) return jumpToDef(view, refEl.dataset.id ?? '')
          const rpos = findRefPosByDom(view, refEl)
          if (rpos === null) return false
          view.dispatch(
            view.state.tr.setSelection(NodeSelection.create(view.state.doc, rpos))
          )
          return true
        }
        const backEl = target.closest?.('.footnote-def-back') as HTMLElement | null
        if (backEl) {
          event.preventDefault()
          const defEl = backEl.closest('.footnote-def') as HTMLElement | null
          return jumpToRef(view, defEl?.dataset.id ?? '')
        }
        return false
      },
      decorations: (state) => buildDefMarkers(state)
    },
    view: (view) => {
      currentView = view
      view.dom.addEventListener('mouseover', onOver)
      view.dom.addEventListener('mouseout', onOut)
      view.dom.addEventListener('mousedown', hideTip)
      // 滚动即收起（fixed 定位提示不跟随内容漂移）
      const host = view.dom.closest('.wysiwyg-host')
      host?.addEventListener('scroll', hideTip, { passive: true })
      return {
        destroy: () => {
          currentView = null
          view.dom.removeEventListener('mouseover', onOver)
          view.dom.removeEventListener('mouseout', onOut)
          view.dom.removeEventListener('mousedown', hideTip)
          host?.removeEventListener('scroll', hideTip)
          hideTip()
        }
      }
    }
  })
})

/** 悬浮提示取定义内容用的活视图（plugin view 挂载时写入） */
let currentView: EditorView | null = null

/* ---------- 角标 NodeView：NodeSelection 时就地展开 [^label] 编辑 ---------- */

class FootnoteRefView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private view: EditorView
  private getPos: () => number | undefined
  private input: HTMLInputElement | null = null
  private editing = false

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = document.createElement('sup')
    this.render()
  }

  private render(): void {
    this.dom.className = 'footnote-ref'
    this.dom.dataset.id = String(this.node.attrs.identifier ?? '')
    this.dom.textContent = `[${String(this.node.attrs.label || this.node.attrs.identifier || '')}]`
  }

  update(node: PMNode): boolean {
    if (!node.sameMarkup(this.node)) return false
    this.node = node
    if (!this.editing) this.render()
    return true
  }

  /** NodeSelection（方向键移到角标/双击）→ 展开源码编辑 */
  selectNode(): void {
    if (!this.view.editable || this.editing) return
    this.startEdit()
  }

  /** 选区离开：失焦语义 = 提交（Typora 光标离开收起源码） */
  deselectNode(): void {
    if (this.editing) this.commit()
  }

  destroy(): void {
    this.editing = false
  }

  stopEvent(event: Event): boolean {
    // 编辑态输入框的事件全部自持（PM 不处理输入/按键）
    return this.editing && this.input != null && this.input.contains(event.target as Node)
  }

  ignoreMutation(): boolean {
    // 文本由本视图自行渲染（render/update），外层忽略一切突变
    return true
  }

  private startEdit(): void {
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    this.editing = true
    this.dom.classList.add('footnote-ref--editing')
    this.dom.textContent = ''
    const input = document.createElement('input')
    input.className = 'footnote-ref-input'
    input.spellcheck = false
    input.value = `[^${String(this.node.attrs.label || this.node.attrs.identifier || '')}]`
    this.dom.appendChild(input)
    this.input = input
    input.addEventListener('mousedown', (e) => e.stopPropagation())
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        this.commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.cancel()
      } else if (e.key === 'Backspace' && input.value === '') {
        // 已清空再退格：删掉整个引用，焦点回编辑器
        e.preventDefault()
        const p = this.getPos()
        if (typeof p !== 'number') return
        const size = this.node.nodeSize
        this.editing = false
        this.input = null
        this.view.dispatch(this.view.state.tr.delete(p, p + size))
        this.view.focus()
      }
    })
    // 轮询聚焦：PM 持焦时 input 会被选区迁移顶掉，持续尝试直到真正持焦
    const focusInput = (tries: number): void => {
      if (!input.isConnected || !this.editing) return
      input.focus()
      if (document.activeElement === input) {
        input.select()
        return
      }
      if (tries > 0) window.setTimeout(() => focusInput(tries - 1), 40)
    }
    focusInput(8)
  }

  private teardownDom(): void {
    this.editing = false
    this.input = null
    this.dom.classList.remove('footnote-ref--editing')
    this.render()
  }

  private commit(): void {
    const raw = this.input?.value ?? ''
    const pos = this.getPos()
    if (typeof pos !== 'number' || !this.view.state.doc.nodeAt(pos)) {
      this.teardownDom()
      return
    }
    const id = sanitizeId(raw)
    const same = id === String(this.node.attrs.identifier ?? '')
    this.teardownDom()
    if (!id || same) {
      // 非法/未变更：还原展示，光标留在原处
      this.view.focus()
      return
    }
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { identifier: id, label: id })
    // 提交后光标落到角标之后（继续输入正文）；不落 NodeSelection 防止立即重开编辑
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1), 1))
    this.view.dispatch(tr)
    this.view.focus()
  }

  private cancel(): void {
    this.teardownDom()
    this.view.focus()
  }
}

export const footnoteRefView = $view(footnoteReferenceSchema.node, (_ctx: Ctx) => (
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined
) => new FootnoteRefView(node, view, getPos))
