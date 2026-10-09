<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
  editorViewCtx,
  serializerCtx,
  remarkCtx,
  remarkPluginsCtx
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { history } from '@milkdown/kit/plugin/history'
import { replaceAll, $prose } from '@milkdown/kit/utils'
import { TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
import {
  createFindPlugin,
  onFindStatus,
  findOpen as pmFindOpen,
  findClose as pmFindClose,
  findSetQuery,
  findGo as pmFindGo,
  findReplaceCurrent,
  findReplaceAll
} from '@/editor/pm-find'
import { createCenterPlugin } from '@/editor/pm-center'
import { createWysiwygImagePlugin } from '@/editor/pm-wysiwyg-image'
import type { FindQuery, FindStatus } from '@/find-shared'
import FindBar from './FindBar.vue'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import '@/assets/wysiwyg.css'

/**
 * 即显（所见即所得）模式：Milkdown/ProseMirror 内核，vanilla API 手动挂载。
 * 与源码模式共用 documents store 作为唯一数据源：
 * - 编辑 → markdownUpdated → updateContent（标脏、走既有保存链路）
 * - 切标签 → replaceAll 整档替换（applying 护栏防误标脏）
 * 组件按需挂载（v-if），进入即显模式时天然读取最新内容。
 */
const docs = useDocumentsStore()
const ui = useUiStore()
const host = ref<HTMLElement | null>(null)

let editor: Editor | null = null
let tabId: number | null = docs.activeId
let applying = false
/** create 完成前收到替换请求时暂存 */
let pending: string | null = null

function applyReplace(markdown: string): void {
  applying = true
  try {
    editor?.action(replaceAll(toWysiwygSource(markdown)))
  } finally {
    applying = false
  }
}

/* ---------- 代码块编辑体验 ---------- */

type MaybeNodeSelection = { node?: { type: { spec: { code?: boolean } } } }

function inCodeBlock(state: EditorState): boolean {
  const sel = state.selection as typeof state.selection & MaybeNodeSelection
  // 文本光标在代码块内，或整个代码块节点被选中（点击 pre 即节点选区）
  return !!sel.$from.parent.type.spec.code || !!sel.node?.type.spec.code
}

/** 节点选区时先把文本光标放进代码块首行 */
function focusCodeStart(view: EditorView): boolean {
  const sel = view.state.selection as typeof view.state.selection & MaybeNodeSelection
  if (!sel.node?.type.spec.code) return false
  const $pos = view.state.doc.resolve(sel.from + 1)
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)))
  return true
}

/** 退出代码块：光标移到代码块之后（append = 先追加一个空段落） */
function exitCodeBlock(view: EditorView, append: boolean): void {
  const { state } = view
  const { $from } = state.selection
  const after = $from.after($from.depth)
  if (append) {
    const para = state.schema.nodes.paragraph.create()
    const tr = state.tr.insert(after, para)
    tr.setSelection(TextSelection.near(tr.doc.resolve(after)))
    view.dispatch(tr)
  } else {
    const pos = state.doc.resolve(Math.min(after, state.doc.content.size))
    view.dispatch(state.tr.setSelection(TextSelection.near(pos, 1)))
  }
}

/**
 * 按键拦截：
 * - 代码块内 Tab / Shift+Tab → 插入/删除缩进（否则浏览器会把焦点跳到状态栏）
 * - Esc → 退出代码块编辑（光标落到块后）
 * - Ctrl/Cmd+Enter → 在代码块后新建段落继续写作
 */
function handleKeys(view: EditorView, event: KeyboardEvent): boolean {
  const { state } = view
  if (event.key === 'Tab') {
    // 始终拦截:普通段落放行 Tab 会被浏览器抢走焦点(跳到状态栏按钮)
    event.preventDefault()
    if (!inCodeBlock(state)) {
      // 普通段落:插入/删除 2 空格,焦点留在编辑器
      const { $from } = state.selection
      if (event.shiftKey) {
        const lineText = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
        const m = /^ {1,2}/.exec(lineText)
        if (m) view.dispatch(state.tr.delete($from.start(), $from.start() + m[0].length))
      } else {
        view.dispatch(state.tr.insertText('  '))
      }
      return true
    }
    if (event.shiftKey) {
      const { $from } = state.selection
      const lineText = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const m = /^ {1,2}/.exec(lineText)
      if (m) view.dispatch(state.tr.delete($from.start(), $from.start() + m[0].length))
    } else {
      focusCodeStart(view)
      view.dispatch(view.state.tr.insertText('  '))
    }
    return true
  }
  if (event.key === 'Escape' && inCodeBlock(state)) {
    exitCodeBlock(view, false)
    return true
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && inCodeBlock(state)) {
    exitCodeBlock(view, true)
    return true
  }
  return false
}

/* ---------- 本地相对路径图片 ⇄ luci-img://（数据层改写） ---------- */

/**
 * remark mdast 清洗：Milkdown 的 image schema 声明 `validate: "string"`，
 * 而 remark 对无 alt/title 的图片给出 null → PM 校验抛 RangeError →
 * Milkdown 的 addNode 把失败静默吞掉 → 图片节点蒸发（段落一起消失）。
 * 在 remark 解析后、PM 转换前把 null 归一化为空串。
 */
interface MdastNode {
  type?: string
  alt?: unknown
  title?: unknown
  children?: MdastNode[]
}

function normalizeImageNulls() {
  return (tree: MdastNode): void => {
    const walk = (n: MdastNode): void => {
      if (n.type === 'image') {
        if (n.alt === null || n.alt === undefined) n.alt = ''
        if (n.title === null || n.title === undefined) n.title = ''
      }
      n.children?.forEach((c) => walk(c))
    }
    walk(tree)
  }
}

/**
 * Milkdown/ProseMirror 按 src 字面值渲染 <img>，相对路径相对应用源解析必裂图；
 * 在 DOM 层改写会被 ProseMirror 的 DOM 同步恢复（上一版方案无效的根因）。
 * 改在数据层：进入即显时把相对路径转为 luci-img:// 绝对协议（state 里显示正确），
 * markdownUpdated 序列化时转回相对路径（store/磁盘上永远是原始相对路径）。
 * 代码围栏内的伪图片文本不动（逐行 + 围栏状态扫描）。
 */
function buildLuciUrl(absPath: string): string {
  return (
    'luci-img://' +
    encodeURIComponent(absPath).replace(/%2F/gi, '/').replace(/\(/g, '%28').replace(/\)/g, '%29')
  )
}

function docDirOf(): string | null {
  const p = docs.active?.path
  if (!p) return null
  const sepIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return sepIdx > 0 ? p.slice(0, sepIdx).replace(/\\/g, '/') : null
}

/** 相对路径图片 → luci-img://（跳过协议/绝对/锚点与代码围栏） */
function toWysiwygSource(md: string): string {
  const docDir = docDirOf()
  if (!docDir) return md
  const lines = md.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const fm = /^(\s*)(`{3,}|~{3,})/.exec(lines[i])
    if (fm) {
      if (fence === null) fence = fm[2].slice(0, 1).repeat(3)
      else if (lines[i].trimStart().startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    lines[i] = lines[i].replace(
      /(\]\()([^)\s]+)(\))/g,
      (whole, open: string, src: string, close: string) => {
        if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|#)/.test(src)) return whole
        let rel = src.replace(/^\.\//, '')
        try {
          rel = decodeURIComponent(rel)
        } catch {
          /* 游离 % 序列按原样 */
        }
        return `${open}${buildLuciUrl(`${docDir}/${rel}`)}${close}`
      }
    )
  }
  return lines.join('\n')
}

/** luci-img:// → 原始相对路径（文档目录内的）；目录外的保留绝对路径 */
function fromWysiwygSource(md: string): string {
  const docDir = docDirOf()
  if (!docDir) return md
  return md.replace(/\]\(luci-img:\/\/([^)\s]+)\)/g, (_whole, enc: string) => {
    let abs: string
    try {
      abs = decodeURIComponent(enc)
    } catch {
      return `](luci-img://${enc})`
    }
    const normDir = docDir.toLowerCase()
    const normAbs = abs.replace(/\\/g, '/')
    if (normAbs.toLowerCase().startsWith(normDir + '/')) {
      return `](./${normAbs.slice(normDir.length + 1)})`
    }
    return `](${normAbs})`
  })
}

/* ---------- 查找替换（Ctrl+F，ProseMirror 层实现见 editor/pm-find.ts） ---------- */

/** 查询状态是唯一真源：FindBar 编辑 → findQuery → watch 驱动插件 */
const findBarOpen = ref(false)
const findQuery = ref<FindQuery>({ text: '', caseSensitive: false, regexp: false, wholeWord: false })
const replaceText = ref('')
const findCount = ref(0)
const findActive = ref(-1)
const findError = ref(false)
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)

/** 插件状态 → Vue 回显（插件经 onFindStatus 推送） */
function syncFindStatus(s: FindStatus): void {
  findBarOpen.value = s.open
  findCount.value = s.count
  findActive.value = s.active
  findError.value = s.error
}

function getView(): EditorView | null {
  try {
    return editor?.action((ctx) => ctx.get(editorViewCtx)) ?? null
  } catch {
    return null
  }
}

/** 打开查找条：有非空单行选区时预填为搜索词（Typora 习惯） */
function openFind(): void {
  const view = getView()
  if (!view) return
  const { from, to, empty } = view.state.selection
  if (!empty && to - from <= 200) {
    const text = view.state.doc.textBetween(from, to, '\n', '')
    if (text && !text.includes('\n')) findQuery.value = { ...findQuery.value, text }
  }
  pmFindOpen(view, { ...findQuery.value })
  void nextTick(() => findBarRef.value?.focusInput())
}

function closeFind(): void {
  const view = getView()
  if (!view) return
  pmFindClose(view)
  view.focus()
}

function goFind(dir: 1 | -1): void {
  const view = getView()
  if (view) pmFindGo(view, dir)
}

function doReplace(): void {
  const view = getView()
  if (view) findReplaceCurrent(view, replaceText.value)
}

function doReplaceAll(): void {
  const view = getView()
  if (view) findReplaceAll(view, replaceText.value)
}

watch(findQuery, (q) => {
  const view = getView()
  if (view && findBarOpen.value) findSetQuery(view, { ...q })
})

/* 菜单 Ctrl+F → 打开即显查找条（不再切回双栏） */
watch(
  () => ui.findRequest,
  () => {
    if (ui.editorMode === 'wysiwyg') openFind()
  }
)

/* 兜底：浏览器 mock 下没有 Electron 菜单，Ctrl+F 直接接管；
   Electron 下加速键由应用菜单统一接管（可改键），旧的硬编码键不再生效 */
function onWinKeydown(e: KeyboardEvent): void {
  if (navigator.userAgent.includes('Electron')) return
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    openFind()
  }
}

/* ---------- 生命周期 ---------- */

/* 查找插件：每次挂载都要一个全新 PM 插件实例（工厂在 Editor 创建时调用） */
const findProse = $prose(() => createFindPlugin())
// GitHub 居中块显示层（<div align="center">,详见 pm-center.ts）
const centerProsePlugin = $prose(() => createCenterPlugin())
// 图片粘贴/拖拽:占位图 → 上传 → 原地换链接（与源码模式共用上传链路）
const wysiwygImagePlugin = $prose(() => createWysiwygImagePlugin())

onMounted(() => {
  if (!host.value) return
  // 点击即显区域任意位置都要让编辑器拿到焦点，避免"点了但打不了字"
  host.value.addEventListener('mousedown', onHostMousedown)
  window.addEventListener('keydown', onWinKeydown)
  onFindStatus(syncFindStatus)
  const instance = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host.value!)
      ctx.set(defaultValueCtx, toWysiwygSource(docs.active?.content ?? ''))
      // remarkPluginsCtx 元素格式为 { plugin, options }（core 按 plug.plugin 取值 use）
      ctx.update(remarkPluginsCtx, (ps) => [
        ...ps,
        { plugin: normalizeImageNulls, options: {} } as never
      ])
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (applying || tabId === null) return
        docs.updateContent(tabId, fromWysiwygSource(markdown))
      })
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: { class: 'luci-prose', spellcheck: 'false' },
        handleKeyDown: (view, event) => handleKeys(view, event)
      }))
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)
    // 撤销/重做（1.7 P0）：commonmark 预设不含 history，不挂载即显模式 Ctrl+Z 完全失效
    .use(history)
    .use(findProse)
    .use(centerProsePlugin)
    .use(wysiwygImagePlugin)
  void instance.create().then((e) => {
    editor = e
    // 开发期调试钩子：CDP 查 PM 文档 JSON / 序列化输出 / 内部 remark mdast
    // （定位解析/序列化丢失层）
    if (!import.meta.env.PROD) {
      ;(window as unknown as Record<string, unknown>).__milkDebug = {
        doc: () =>
          editor?.action((ctx) => ctx.get(editorViewCtx).state.doc.toJSON()),
        md: () =>
          editor?.action((ctx) => {
            const ser = ctx.get(serializerCtx)
            const view = ctx.get(editorViewCtx)
            return String(ser(view.state.doc))
          }),
        remark: (src: string) =>
          editor?.action((ctx) => {
            const proc = ctx.get(remarkCtx)
            const tree = proc.runSync(proc.parse(src)) as unknown as MdastNode
            const walk = (n: MdastNode): unknown =>
              n.type === 'image'
                ? { type: n.type, alt: n.alt, title: n.title }
                : { type: n.type, kids: (n.children ?? []).map(walk) }
            return JSON.stringify(walk(tree))
          })
      }
    }
    if (pending !== null) {
      const md = pending
      pending = null
      applyReplace(md)
    }
  })
})

onBeforeUnmount(() => {
  host.value?.removeEventListener('mousedown', onHostMousedown)
  window.removeEventListener('keydown', onWinKeydown)
  onFindStatus(null)
  try {
    editor?.destroy()
  } catch {
    /* destroy 期间文档已切换时可能抛错，忽略 */
  }
  editor = null
})

function onHostMousedown(): void {
  try {
    const view = editor?.action((ctx) => ctx.get(editorViewCtx))
    if (view && !view.hasFocus) view.focus()
  } catch {
    /* 编辑器未就绪时忽略 */
  }
}

/* 切换标签：整档替换（编辑器未就绪时暂存，create 完成后应用），并回到顶部 */
watch(
  () => docs.activeId,
  (id) => {
    tabId = id
    const markdown = docs.active?.content ?? ''
    if (editor) applyReplace(markdown)
    else pending = markdown
    if (host.value) host.value.scrollTop = 0
  }
)

/* 外部修改重载：store 内容已被写回，即显面板整档替换 */
watch(
  () => ui.extReloadSeq,
  () => {
    const markdown = docs.active?.content ?? ''
    if (editor) applyReplace(markdown)
    else pending = markdown
  }
)
</script>

<template>
  <div class="wysiwyg-wrap">
    <!-- 查找条：停靠在面板顶部，不遮挡正文（Esc 关闭后完全移除） -->
    <FindBar
      v-if="findBarOpen"
      ref="findBarRef"
      :query="findQuery"
      :replace="replaceText"
      :count="findCount"
      :active="findActive"
      :error="findError"
      @update:query="findQuery = $event"
      @update:replace="replaceText = $event"
      @nav="goFind"
      @replace="doReplace"
      @replace-all="doReplaceAll"
      @close="closeFind"
    />
    <div ref="host" class="wysiwyg-host" />
  </div>
</template>

<style scoped>
.wysiwyg-wrap {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.wysiwyg-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  position: relative;
}
</style>
