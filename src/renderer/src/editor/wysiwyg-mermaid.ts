import { $prose, $view } from '@milkdown/kit/utils'
import { codeBlockAttr, codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import type { Ctx } from '@milkdown/kit/ctx'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration } from '@milkdown/kit/prose/view'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { useUiStore } from '@/stores/ui'
import {
  applyMermaidConfigInLock,
  configMermaidFor,
  getMermaidCache,
  isHealthyMermaidSvg,
  loadMermaid,
  mermaidCacheKey,
  rethemeMermaid,
  setMermaidCache,
  withMermaidLock
} from '@/services/mermaid'

/**
 * 即显 Mermaid（ROADMAP 1.2）：code_block 的双模 nodeView。
 * - language === 'mermaid'：渲染图表（pre 外壳保留——chrome 插件的复制按钮读
 *   相邻 pre、语言标签照常），点击图表进入源码编辑态（contentDOM 即原生 code
 *   元素，Esc/Tab/Ctrl+Enter 等既有代码块键盘行为全部沿用）；
 * - 其他语言：完全复刻内置 toDOM（pre[data-language] > code），观感与行为不变。
 * 得益于按节点类型接管，手打 ```mermaid 建块即直接成为图表。
 * 主题切换：rethemeMermaidViews() 重配置 + 重画所有活实例（WysiwygEditor watch 驱动）。
 */

function isDark(): boolean {
  return useUiStore().effectiveTheme === 'dark'
}

const liveViews = new Set<MermaidCodeView>()

/** 主题切换入口：重配置 mermaid 并重画所有存活实例（渲染走缓存+串行锁）。
 *  WysiwygEditor watch ui.effectiveTheme 驱动 */
export function rethemeMermaidViews(dark: boolean): void {
  rethemeMermaid(dark)
  for (const v of liveViews) v.requestRender()
}

/** codeBlockAttr 取属性函数签名（构造期复刻内置 pre/code 属性） */
type CodeBlockAttrFn = (node: PMNode) => {
  pre?: Record<string, string>
  code?: Record<string, string>
}

class MermaidCodeView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private node: PMNode
  private view: EditorView
  private getPos: () => number | undefined
  private attrFn: CodeBlockAttrFn
  private renderDiv: HTMLDivElement | null = null
  private editing = false
  private renderSeq = 0
  /** 当前渲染内容指纹：update 时判断是否需要重画 */
  private renderedCode: string | null = null
  /** 编辑态实时预览的防抖定时器 */
  private renderTimer: number | null = null

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    attrFn: CodeBlockAttrFn
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.attrFn = attrFn

    const lang = this.lang()
    const attr = this.attrsOf(node)
    this.dom = document.createElement('pre')
    for (const [k, v] of Object.entries(attr.pre ?? {})) this.dom.setAttribute(k, String(v))
    if (lang) this.dom.setAttribute('data-language', lang)

    this.contentDOM = document.createElement('code')
    for (const [k, v] of Object.entries(attr.code ?? {})) {
      this.contentDOM.setAttribute(k, String(v))
    }
    this.dom.appendChild(this.contentDOM)

    if (this.isMermaid()) {
      this.dom.classList.add('md-mermaid')
      this.renderDiv = document.createElement('div')
      this.renderDiv.className = 'md-mermaid-render'
      this.dom.insertBefore(this.renderDiv, this.contentDOM)
      this.dom.addEventListener('mousedown', this.onMouseDown)
      liveViews.add(this)
      void this.render()
    }
  }

  private lang(): string {
    return String(this.node.attrs.language ?? '').trim().toLowerCase()
  }

  private isMermaid(): boolean {
    return this.lang() === 'mermaid'
  }

  /** 复刻内置 $nodeAttr("codeBlock") 的 pre/code 属性对象 */
  private attrsOf(node: PMNode): { pre?: Record<string, string>; code?: Record<string, string> } {
    try {
      return this.attrFn(node) ?? {}
    } catch {
      return {}
    }
  }

  update(node: PMNode): boolean {
    if (!node.sameMarkup(this.node)) return false
    const wasMermaid = this.isMermaid()
    this.node = node
    if (this.isMermaid() !== wasMermaid) return false // 语言切换：交给 PM 重建视图
    if (this.isMermaid()) {
      const code = node.textContent
      if (code !== this.renderedCode) {
        // 编辑态实时预览（Typora 语义）：源码改动防抖重画；非编辑态维持即时重画
        if (this.editing) this.scheduleRender()
        else void this.render()
      }
    }
    return true
  }

  destroy(): void {
    liveViews.delete(this)
    this.renderSeq++
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer)
    this.dom.removeEventListener('mousedown', this.onMouseDown)
  }

  /** 编辑态唯一写入口：由 mermaidFocusPlugin 按选区位置驱动（TextSelection 在块内
   *  不触发 PM 的 selectNode/deselectNode，那里靠不住） */
  setEditing(on: boolean): void {
    if (!this.isMermaid() || this.editing === on) return
    this.editing = on
    this.dom.classList.toggle('md-mermaid--editing', on)
    if (this.node.textContent !== this.renderedCode) {
      if (on) this.scheduleRender()
      else void this.render()
    }
  }

  /** 编辑态实时预览（Typora 语义）：源码改动 300ms 防抖后重画。
   *  编辑中渲染失败保留上一次成功图表（render 失败路径按 editing 分流） */
  private scheduleRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null
      void this.render()
    }, 300)
  }

  get pos(): number | null {
    const p = this.getPos()
    return typeof p === 'number' ? p : null
  }

  /** 焦点插件用的编辑态只读访问 */
  get isEditing(): boolean {
    return this.editing
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    // 渲染区的突变一律忽略；contentDOM（code 源码）的交给 PM
    if (!this.renderDiv) return false
    return !this.contentDOM.contains(m.target as Node)
  }

  stopEvent(event: Event): boolean {
    // 非编辑态点击渲染区：由本视图接管（PM 不再按位置摆光标）
    if (!this.isMermaid() || this.editing) return false
    return (
      event.type === 'mousedown' &&
      event.target instanceof Node &&
      this.renderDiv?.contains(event.target) === true
    )
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.isMermaid() || this.editing) return
    if (!(e.target instanceof Node) || this.renderDiv?.contains(e.target) !== true) return
    e.preventDefault()
    e.stopPropagation()
    const pos = this.getPos()
    if (typeof pos !== 'number') return
    // 先 NodeSelection 触发 selectNode（进入源码态），再把光标放进源码末尾；
    // 分两次 dispatch——合并的话最终是 TextSelection，selectNode 不会被调用
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)))
    const size = this.node.content.size
    this.view.dispatch(
      this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos + 1 + size))
    )
    this.view.focus()
  }

  /** 主题切换等外部触发的重画 */
  requestRender(): void {
    if (!this.isMermaid() || this.editing) return
    this.renderedCode = null // 强制重画（同源码换主题）
    void this.render()
  }

  private async render(): Promise<void> {
    const div = this.renderDiv
    if (!div) return
    const seq = ++this.renderSeq
    const code = this.node.textContent
    const dark = isDark()
    const key = mermaidCacheKey(code, dark)

    const hit = getMermaidCache(key)
    if (hit !== undefined) {
      this.applyHtml(seq, code, hit)
      return
    }

    // 占位：渲染期间保持图表区高度稳定感（至少给出可点击区域）
    div.classList.add('md-mermaid--loading')

    const m = await loadMermaid(dark)
    if (!m) {
      if (this.editing) this.failKeepRender(seq)
      else this.showError(seq, code)
      return
    }
    // 渲染轮次前重应用当前主题配置（HMR 重挂载/切主题窗口期防旧配置）
    configMermaidFor(dark)

    const html = await withMermaidLock(async () => {
      // 健康校验 + 失败重试一次（挂载/主题竞态下 mermaid 可能画出 0×0 退化图）
      let out: string | null = null
      for (let attempt = 0; attempt < 2 && out === null; attempt++) {
        const holder = document.createElement('div')
        // 离屏挂载（mermaid 测量需要布局）：同宽度，脱离文档流
        holder.style.cssText = `position:absolute;left:-9999px;top:0;width:${Math.max(this.dom.clientWidth, 320)}px`
        holder.textContent = code
        document.body.appendChild(holder)
        try {
          // run 读执行时刻的全局配置：排队期间主题翻转会让上面的 configMermaidFor
          // 过期——锁内按当下极性重应用，图表不串色
          applyMermaidConfigInLock(isDark())
          await m.run({ nodes: [holder] })
        } catch {
          /* 失败在下方统一降级 */
        }
        // mermaid v12 的 run 吞掉语法错误改画错误图（aria-roledescription="error"），
        // 有 svg ≠ 成功——错误图/退化图同样走源码降级
        if (isHealthyMermaidSvg(holder.querySelector('svg'))) out = holder.innerHTML
        holder.remove()
      }
      return out
    })

    if (seq !== this.renderSeq) return // 已有更新一轮渲染（或视图销毁）
    // 渲染期间主题翻转：成品是旧极性、缓存键也已错位——按新极性重画
    if (isDark() !== dark) {
      this.renderedCode = null
      void this.render()
      return
    }
    if (html === null) {
      if (this.editing) this.failKeepRender(seq)
      else this.showError(seq, code)
      return
    }
    setMermaidCache(key, html)
    this.applyHtml(seq, code, html)
  }

  /** 编辑态渲染失败（语法错误中途态）：只摘 loading，renderDiv 里上一次成功的
   *  SVG 原样保留（innerHTML 未被触碰），不闪源码降级/错误图；renderedCode
   *  不更新，下次输入继续尝试 */
  private failKeepRender(seq: number): void {
    if (seq !== this.renderSeq || !this.renderDiv) return
    this.renderDiv.classList.remove('md-mermaid--loading')
  }

  private applyHtml(seq: number, code: string, html: string): void {
    if (seq !== this.renderSeq || !this.renderDiv) return
    this.renderedCode = code
    this.renderDiv.classList.remove('md-mermaid--loading', 'md-mermaid--error')
    this.renderDiv.innerHTML = html
  }

  private showError(seq: number, code: string): void {
    if (seq !== this.renderSeq || !this.renderDiv) return
    this.renderedCode = code
    this.renderDiv.classList.remove('md-mermaid--loading')
    this.renderDiv.classList.add('md-mermaid--error')
    // 与预览管线一致：渲染失败还原源码展示
    this.renderDiv.textContent = code
  }
}

/** nodeView 工厂：注入 codeBlockAttr 取属性函数（构造期复刻内置 pre/code 属性） */
export const mermaidCodeView = $view(codeBlockSchema.node, (ctx: Ctx) => {
  const attrFn = (node: PMNode) => ctx.get(codeBlockAttr.key)(node) as {
    pre?: Record<string, string>
    code?: Record<string, string>
  }
  return (node: PMNode, view: EditorView, getPos: () => number | undefined, _deco: readonly Decoration[]) =>
    new MermaidCodeView(node, view, getPos, attrFn)
})

/** 焦点追踪：按选区位置驱动各 mermaid 块的编辑态——选区落在哪个 code_block 内，
 *  哪个块进源码态，其余全部收起（点击别处/Esc/方向键跳出统一收口） */
export const mermaidFocusPlugin = $prose(() =>
  new Plugin({
    key: new PluginKey<unknown>('luci-mermaid-focus'),
    view: () => ({
      update: (view: EditorView, prevState: EditorState) => {
        if (view.state.selection === prevState.selection) return
        const { selection: sel } = view.state
        const nodeSel = (sel as typeof sel & { node?: { type: { name: string } } }).node
        let blockPos: number | null = null
        if (nodeSel?.type.name === 'code_block') {
          blockPos = sel.from
        } else {
          for (let d = sel.$from.depth; d > 0; d--) {
            if (sel.$from.node(d).type.name === 'code_block') {
              blockPos = sel.$from.before(d)
              break
            }
          }
        }
        for (const v of liveViews) {
          v.setEditing(blockPos !== null && v.pos === blockPos)
        }
      }
    })
  })
)
