<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { search, openSearchPanel } from '@codemirror/search'
import { indentWithTab } from '@codemirror/commands'
import { luciTheme } from '@/editor/cm-theme'
import { cmPhrases } from '@/editor/cm-i18n'
import { formattingKeymap } from '@/editor/cm-commands'
import { luciFocusMode, luciTypewriterMode } from '@/editor/cm-focus'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { htmlToMarkdown } from '@/services/richPaste'
import { t } from '@/i18n'
import {
  detectTable,
  applyTableOp,
  cellStart,
  type TableInfo,
  type TableOp
} from '@/editor/table-utils'

const emit = defineEmits<{ (e: 'scroll-sync', line: number, frac: number): void }>()

const ui = useUiStore()
const docs = useDocumentsStore()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let tabId: number | null = null
/** 外部整档替换（切标签）不记 dirty、不触发同步 */
let applying = false
/** 程序滚动后的短暂锁，避免双栏同步回声 */
let lockUntil = 0
/** 专注/打字机模式按需装卸 */
const focusComp = new Compartment()
const typewriterComp = new Compartment()
/** CodeMirror 内置界面短语（搜索面板等）随语言热切换 */
const phrasesComp = new Compartment()
/** 光标所在表格（悬浮工具栏数据源） */
const tableInfo = ref<TableInfo | null>(null)

function makeState(content: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      search({ top: true }),
      phrasesComp.of(cmPhrases()),
      keymap.of([indentWithTab, ...formattingKeymap]),
      luciTheme,
      focusComp.of(ui.focusMode ? luciFocusMode : []),
      typewriterComp.of(ui.typewriterMode ? luciTypewriterMode : []),
      EditorView.updateListener.of((u: ViewUpdate) => {
        // 表格检测只读状态，放在 applying 守卫之外：整档替换后也要刷新
        if (u.docChanged || u.selectionSet) updateTableInfo()
        if (applying) return
        if (u.docChanged && tabId !== null) {
          docs.updateContent(tabId, u.state.doc.toString())
        }
        if (u.docChanged || u.selectionSet) {
          ui.currentLine = u.state.doc.lineAt(u.state.selection.main.head).number
        }
      }),
      EditorView.domEventHandlers({
        paste: (event, view) => handlePaste(event, view),
        drop: (event, view) => void insertImagesFrom(event.dataTransfer, view, event)
      })
    ]
  })
}

/* ---------- 图片粘贴/拖拽 → 自动落盘 .assets 并插入链接 ---------- */

function fileExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  }
  return map[mime] ?? 'png'
}

async function insertImagesFrom(
  dt: DataTransfer | null,
  view: EditorView,
  event: Event
): Promise<boolean> {
  const files = [...(dt?.files ?? [])].filter((f) => f.type.startsWith('image/'))
  if (files.length === 0) return false
  event.preventDefault()

  const tab = docs.tabs.find((t) => t.id === tabId)
  if (!tab?.path) {
    ui.showToast(t('editor.saveFirstForImage'))
    return true
  }
  const docPath = tab.path
  const sepIdx = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  const dir = sepIdx > 0 ? docPath.slice(0, sepIdx) : '.'
  const base = (docPath.split(/[\\/]/).pop() ?? 'doc').replace(/\.[^.]+$/, '')
  const assetsDir = `${base}.assets`
  const stamp = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(
    stamp.getHours()
  )}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`

  const links: string[] = []
  for (const [i, file] of files.entries()) {
    const name = `IMG_${ts}${files.length > 1 ? `_${i + 1}` : ''}.${fileExt(file.type)}`
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let k = 0; k < buf.length; k += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(k, k + 0x8000))
    }
    try {
      await window.api.fs.writeFileBinary(`${dir}/${assetsDir}/${name}`, btoa(bin))
      links.push(`![${name}](./${assetsDir}/${name})`)
    } catch (err) {
      console.error('[editor] image save failed:', err)
      ui.showToast(t('editor.imageSaveFailed', { name }))
    }
  }
  if (links.length === 0) return true
  const pos = view.state.selection.main.head
  view.dispatch({
    changes: { from: pos, insert: links.join('\n') + '\n' }
  })
  ui.showToast(t('editor.imagesInserted', { n: links.length, dir: assetsDir }))
  return true
}

/**
 * 粘贴分流：图片文件 → 自动落盘；富文本（text/html）→ 转 Markdown；
 * 其余（纯文本）→ 编辑器默认粘贴。返回 true 表示已接管该事件。
 */
function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
  const dt = event.clipboardData
  if (!dt) return false
  if ([...dt.files].some((f) => f.type.startsWith('image/'))) {
    void insertImagesFrom(dt, view, event)
    return true
  }
  const html = dt.getData('text/html')
  // 没有标签结构（或只有 <meta> 碎片）的纯文本复制不接管
  if (!html || !/<[a-z!][^>]*>/i.test(html)) return false
  const plain = dt.getData('text/plain') ?? ''
  const md = htmlToMarkdown(html)
  if (md === null || md === plain.trim()) return false
  event.preventDefault()
  const { from, to } = view.state.selection.main
  view.dispatch({ changes: { from, to, insert: md }, scrollIntoView: true })
  return true
}

/* ---------- 表格悬浮工具栏 ---------- */

function updateTableInfo(): void {
  if (!view) {
    tableInfo.value = null
    return
  }
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  tableInfo.value = detectTable(
    view.state.doc.lines,
    (n) => view!.state.doc.line(n).text,
    line.number,
    pos - line.from
  )
}

function runTableOp(op: TableOp): void {
  if (!view || !tableInfo.value) return
  const info = tableInfo.value
  const blockLines: string[] = []
  for (let n = info.startLine; n <= info.endLine; n++) {
    blockLines.push(view.state.doc.line(n).text)
  }
  const edit = applyTableOp(blockLines, info, op)
  if (!edit) return
  const blockFrom = view.state.doc.line(info.startLine).from
  const anchor =
    edit.lines.length === 0
      ? blockFrom
      : blockFrom +
        edit.lines.slice(0, Math.min(edit.cursorLine, edit.lines.length - 1)).reduce(
          (acc, text) => acc + text.length + 1,
          0
        ) +
        cellStart(edit.lines[Math.min(edit.cursorLine, edit.lines.length - 1)], edit.cursorCol)
  view.dispatch({
    changes: {
      from: blockFrom,
      to: view.state.doc.line(info.endLine).to,
      insert: edit.lines.join('\n')
    },
    selection: { anchor }
  })
  view.focus()
}

function canDeleteRow(): boolean {
  return !!tableInfo.value && tableInfo.value.cursorLine - tableInfo.value.startLine > 1
}

function canDeleteCol(): boolean {
  return !!tableInfo.value && tableInfo.value.colCount > 1
}

/* 编辑器滚动 → 通知预览：视口顶行的行号（setTimeout 节流，不依赖渲染帧） */
let scrollPending = false
function onScrollDom(): void {
  if (Date.now() < lockUntil || scrollPending) return
  scrollPending = true
  window.setTimeout(() => {
    scrollPending = false
    // 排队期间若刚发生过程序同步，丢弃本次陈旧行号，避免回声
    if (!view || Date.now() < lockUntil) return
    const sd = view.scrollDOM
    const rect = sd.getBoundingClientRect()
    // posAtCoords 接收视口（client）坐标：取文本区中部、视口顶下方 4px
    const pos = view.posAtCoords({ x: rect.left + sd.clientWidth * 0.4, y: rect.top + 4 })
    const line =
      pos !== null
        ? view.state.doc.lineAt(pos).number
        : view.state.doc.lineAt(view.state.selection.main.head).number
    emit('scroll-sync', line, 0)
  }, 16)
}

/* 预览滚动 → 同步编辑器：
   直接按高度图估算设置 scrollTop（不依赖渲染帧），再让 scrollIntoView 在
   可见环境下用精确测量修正。两者目标一致（该行贴视口顶），不会互相打架。 */
function syncToLine(line: number, _frac: number): void {
  if (!view) return
  const ln = Math.min(Math.max(1, Math.round(line)), view.state.doc.lines)
  const pos = view.state.doc.line(ln).from
  const sd = view.scrollDOM
  const content = sd.querySelector<HTMLElement>('.cm-content')
  lockUntil = Date.now() + 120
  const block = view.lineBlockAt(pos)
  sd.scrollTop = Math.max(0, block.top + (content?.offsetTop ?? 0) - 6)
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 6 })
  })
}

defineExpose({ syncToLine })

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    state: makeState(docs.active?.content ?? ''),
    parent: host.value
  })
  tabId = docs.activeId
  view.scrollDOM.addEventListener('scroll', onScrollDom, { passive: true })
  // 点击编辑区任意位置（含内边距/行号间隙）都要拿到焦点，避免"点了但打不了字"
  host.value.addEventListener('mousedown', onHostMousedown)
})

function onHostMousedown(): void {
  if (view && !view.hasFocus) view.focus()
}

onBeforeUnmount(() => {
  host.value?.removeEventListener('mousedown', onHostMousedown)
  view?.scrollDOM.removeEventListener('scroll', onScrollDom)
  view?.destroy()
  view = null
})

/* 切换标签：整档替换（M1 不保留每标签 undo/滚动栈） */
watch(
  () => docs.activeId,
  (id) => {
    if (!view || id === null) return
    applying = true
    view.setState(makeState(docs.active?.content ?? ''))
    view.scrollDOM.scrollTop = 0
    tabId = id
    ui.currentLine = 1
    applying = false
  }
)

/* 菜单 Ctrl+F → 打开查找面板 */
watch(
  () => ui.findRequest,
  () => {
    if (view) openSearchPanel(view)
  }
)

/* 大纲点击跳转：光标落行并居中 */
watch(
  () => ui.jumpLine,
  (j) => {
    if (!view || !j) return
    const ln = Math.min(Math.max(1, j.line), view.state.doc.lines)
    const pos = view.state.doc.line(ln).from
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' })
    })
  }
)

/* 外部修改重载：store 内容已被写回（静默重载或用户确认），整档重新同步 */
watch(
  () => ui.extReloadSeq,
  () => {
    if (!view) return
    const target = docs.active?.content ?? ''
    if (view.state.doc.toString() === target) return
    applying = true
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: target } })
    applying = false
  }
)

/* 模式切换后重新测量；从即显模式回到源码时，重同步 store 里的最新内容 */
watch(
  () => ui.editorMode,
  (mode) => {
    if (!view) return
    view.requestMeasure()
    if (mode === 'edit' || mode === 'split') {
      const target = docs.active?.content ?? ''
      if (view.state.doc.toString() !== target) {
        applying = true
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: target } })
        applying = false
      }
    }
  }
)

/* 专注 / 打字机模式热切换 */
watch(
  () => ui.focusMode,
  (on) => view?.dispatch({ effects: focusComp.reconfigure(on ? luciFocusMode : []) })
)
watch(
  () => ui.typewriterMode,
  (on) => view?.dispatch({ effects: typewriterComp.reconfigure(on ? luciTypewriterMode : []) })
)

/* 语言切换：CodeMirror 内置界面短语热替换 */
watch(
  () => ui.localePref,
  () => view?.dispatch({ effects: phrasesComp.reconfigure(cmPhrases()) })
)
</script>

<template>
  <div class="cm-host-wrap">
    <transition name="tablebar">
      <div v-if="tableInfo" class="table-bar" @mousedown.prevent>
        <span class="tb-size">{{ tableInfo.bodyCount + 1 }} × {{ tableInfo.colCount }}</span>
        <i class="tb-sep" />
        <button :title="$t('table.addRowAbove')" @click="runTableOp({ kind: 'row-above' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 8.5h10M2 11.5h10M7 1.5v3M5.5 3h3" /></svg>
        </button>
        <button :title="$t('table.addRowBelow')" @click="runTableOp({ kind: 'row-below' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 2.5h10M2 5.5h10M7 9.5v3M5.5 11h3" /></svg>
        </button>
        <button :title="$t('table.deleteRow')" :disabled="!canDeleteRow()" class="danger" @click="runTableOp({ kind: 'row-delete' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 2.5h10M2 5.5h10M2 11h6M9.5 9.5l3.5 3.5M13 9.5l-3.5 3.5" /></svg>
        </button>
        <i class="tb-sep" />
        <button :title="$t('table.addColLeft')" @click="runTableOp({ kind: 'col-left' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6.5 2v10M10 2v10M1.5 7h3M3 5.5v3" /></svg>
        </button>
        <button :title="$t('table.addColRight')" @click="runTableOp({ kind: 'col-right' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 2v10M7.5 2v10M9.5 7h3M11 5.5v3" /></svg>
        </button>
        <button :title="$t('table.deleteCol')" :disabled="!canDeleteCol()" class="danger" @click="runTableOp({ kind: 'col-delete' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 2v10M7.5 2v10M9.5 5.5l4 4M13.5 5.5l-4 4" /></svg>
        </button>
        <i class="tb-sep" />
        <button :title="$t('table.alignLeft')" @click="runTableOp({ kind: 'align', how: 'left' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M2 7h6M2 10.5h10" /></svg>
        </button>
        <button :title="$t('table.alignCenter')" @click="runTableOp({ kind: 'align', how: 'center' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M4 7h6M2 10.5h10" /></svg>
        </button>
        <button :title="$t('table.alignRight')" @click="runTableOp({ kind: 'align', how: 'right' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M6 7h6M2 10.5h10" /></svg>
        </button>
        <button :title="$t('table.alignNone')" @click="runTableOp({ kind: 'align', how: 'none' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 3.5h10M2 7h10M2 10.5h10" /></svg>
        </button>
        <i class="tb-sep" />
        <button :title="$t('table.deleteTable')" class="danger" @click="runTableOp({ kind: 'table-delete' })">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h8M5.5 4V2.5h3V4M4 4l.5 7.5h5L10 4M6 6.5v3M8 6.5v3" /></svg>
        </button>
      </div>
    </transition>
    <div ref="host" class="cm-host" />
  </div>
</template>

<style scoped>
.cm-host-wrap {
  position: relative;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cm-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

/* 表格悬浮工具栏：光标进入表格时浮现于编辑器右上角 */
.table-bar {
  position: absolute;
  top: 6px;
  right: 14px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 3px 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-pop);
}

.tb-size {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-2);
  padding: 0 5px;
}

.tb-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 4px;
  flex-shrink: 0;
}

.table-bar button {
  width: 26px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: var(--text-2);
  flex-shrink: 0;
}

.table-bar button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.table-bar button.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.table-bar button:disabled {
  opacity: 0.35;
  cursor: default;
}

.tablebar-enter-active,
.tablebar-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.tablebar-enter-from,
.tablebar-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
