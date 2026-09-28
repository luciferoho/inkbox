<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { replaceAll } from '@milkdown/kit/utils'
import { TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
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
    editor?.action(replaceAll(markdown))
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
    if (!inCodeBlock(state)) return false
    event.preventDefault()
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

onMounted(() => {
  if (!host.value) return
  // 点击即显区域任意位置都要让编辑器拿到焦点，避免"点了但打不了字"
  host.value.addEventListener('mousedown', onHostMousedown)
  const instance = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host.value!)
      ctx.set(defaultValueCtx, docs.active?.content ?? '')
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (applying || tabId === null) return
        docs.updateContent(tabId, markdown)
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
  void instance.create().then((e) => {
    editor = e
    if (pending !== null) {
      const md = pending
      pending = null
      applyReplace(md)
    }
  })
})

onBeforeUnmount(() => {
  host.value?.removeEventListener('mousedown', onHostMousedown)
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

/* 切换标签：整档替换（编辑器未就绪时暂存，create 完成后应用） */
watch(
  () => docs.activeId,
  (id) => {
    tabId = id
    const markdown = docs.active?.content ?? ''
    if (editor) applyReplace(markdown)
    else pending = markdown
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
  <div ref="host" class="wysiwyg-host" />
</template>

<style scoped>
.wysiwyg-host {
  height: 100%;
  min-width: 0;
  overflow-y: auto;
  position: relative;
}
</style>
