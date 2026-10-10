<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, keymap, type Command, type ViewUpdate } from '@codemirror/view'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { search, SearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll as cmReplaceAll } from '@codemirror/search'
import { luciFindHighlight, setLuciFindQuery } from '@/editor/cm-find-highlight'
import { indentWithTab } from '@codemirror/commands'
import { luciTheme } from '@/editor/cm-theme'
import { yamlFrontmatter } from '@/editor/cm-frontmatter'
import { cmPhrases } from '@/editor/cm-i18n'
import {
  formattingKeymap,
  cmdBold,
  continueList,
  deleteListMarker,
  cmdItalic,
  cmdStrike,
  cmdInlineCode,
  cmdHighlight,
  cmdLink,
  cmdHeadingUp,
  cmdHeadingDown
} from '@/editor/cm-commands'
import { luciFocusMode, luciTypewriterMode } from '@/editor/cm-focus'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import type { FindQuery } from '@/find-shared'
import FindBar from './FindBar.vue'
import { htmlToMarkdown } from '@/services/richPaste'
import { t } from '@/i18n'
import {
  assetsDirFor,
  fileExt,
  mimeFromName,
  persistImage
} from '@/editor/image-persist'
import {
  detectTable,
  applyTableOp,
  cellStart,
  type TableInfo,
  type TableOp
} from '@/editor/table-utils'
import {
  parseImageLine,
  applyImageMods,
  stepWidth,
  widthLabel,
  type ImageMods
} from '@/editor/image-utils'

const emit = defineEmits<{
  (e: 'scroll-sync', line: number, frac: number): void
  (e: 'image-focus', line: number | null, k: number): void
}>()

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
/** Vim 模式按需装卸：扩展体动态 import（~40KB 不进入口 chunk），已加载后缓存复用 */
const vimComp = new Compartment()
type VimModule = typeof import('@replit/codemirror-vim')
let vimApi: VimModule | null = null
let vimExt: Extension[] | null = null

async function loadVim(): Promise<VimModule> {
  vimApi ??= await import('@replit/codemirror-vim')
  // 注意：不能传 { status: true }——其面板工厂在 view.cm 挂载前执行会抛错，
  // CM 会把整个 vim 扩展回滚（上游 bug）；模式指示由状态栏徽标自行实现
  if (!vimExt) vimExt = [vimApi.vim()]
  return vimApi
}

/** Vim 普通/可视模式下让位：Enter/Backspace 的 typora 语义只在插入态（或未开 vim）生效 */
function vimOwnsKey(v: EditorView): boolean {
  if (!ui.vimMode || !vimApi) return false
  const vim = vimApi.getCM(v)?.state.vim
  return !!vim && !vim.insertMode
}

/** 普通态键位显式委托给 vim 命令解析（lib 的 keymap 不接管 Enter/Backspace，需手动转发） */
function vimHandle(v: EditorView, key: string): boolean {
  if (!vimOwnsKey(v) || !vimApi) return false
  const cm = vimApi.getCM(v)
  if (cm) vimApi?.Vim.handleKey(cm, key, 'mapping')
  return true
}

async function syncVim(on: boolean): Promise<void> {
  if (!on) {
    view?.dispatch({ effects: vimComp.reconfigure([]) })
    ui.vimInsert = false
    return
  }
  await loadVim()
  view?.dispatch({ effects: vimComp.reconfigure(vimExt as Extension[]) })
}
/** CodeMirror 内置界面短语（搜索面板等）随语言热切换 */
const phrasesComp = new Compartment()
/** 光标所在表格（停靠工具条的数据源：在表格内 → 表格操作，否则 → 格式化操作） */
const tableInfo = ref<TableInfo | null>(null)
/** 光标行内的图片（工具条切换为图片尺寸/对齐操作；表格优先） */
const imageInfo = ref<ReturnType<typeof parseImageLine> | null>(null)

function makeState(content: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      // Mod-f 路由到自建查找条（拦在 basicSetup 的 searchKeymap 之前，别再开内置面板）；
      // Electron 下应用菜单统一接管全局键（可改键，见 shared/shortcuts），这里只给浏览器 mock 兜底；
      // Enter 续行 / Backspace 删标记同样必须最先注册：lang-markdown 自带 Prec.high 的
      // markdownKeymap（addKeymap 默认开，已禁用）与 defaultKeymap 都会抢先拦截
      keymap.of([
        ...(navigator.userAgent.includes('Electron')
          ? []
          : [{ key: 'Mod-f', run: () => (ui.requestFind(), true) }]),
        { key: 'Enter', run: (v) => (vimOwnsKey(v) ? vimHandle(v, '<CR>') : continueList(v)) },
        { key: 'Backspace', run: (v) => (vimOwnsKey(v) ? vimHandle(v, '<BS>') : deleteListMarker(v)) }
      ]),
      basicSetup,
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [yamlFrontmatter] }),
      search({ top: true }),
      luciFindHighlight(),
      phrasesComp.of(cmPhrases()),
      keymap.of([indentWithTab, ...formattingKeymap]),
      luciTheme,
      focusComp.of(ui.focusMode ? luciFocusMode : []),
      typewriterComp.of(ui.typewriterMode ? luciTypewriterMode : []),
      vimComp.of(ui.vimMode && vimExt ? vimExt : []),
      EditorView.updateListener.of((u: ViewUpdate) => {
        // Vim 插入态回报（状态栏徽标），先于 applying 守卫
        if (ui.vimMode && vimApi) {
          ui.vimInsert = !!vimApi.getCM(u.view)?.state.vim?.insertMode
        }
        // 表格/图片检测只读状态，放在 applying 守卫之外：整档替换后也要刷新
        if (u.docChanged || u.selectionSet) {
          updateTableInfo()
          updateImageInfo()
          updateImageFocus(u.state)
          if (findBarOpen.value) recountMatches()
        }
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

/* ---------- 图片粘贴/拖拽 → 上传链路见 editor/image-persist.ts ---------- */

/**
 * 上传占位符：粘贴/插入图片后立即在光标处显示「上传中」,完成后原地替换为最终链接。
 * 纯文本占位（含唯一 id），替换按整串精确查找，用户上传期间的编辑不会破坏替换定位。
 */
let uploadSeq = 0
function withUploadingPlaceholder(
  view: EditorView,
  run: (finish: (link: string | null) => void) => Promise<void>
): Promise<void> {
  const uid = `${Date.now()}-${++uploadSeq}`
  const ph = `⏳ ${t('editor.imageUploading')} (inkbox-uploading-${uid})`
  const pos = view.state.selection.main.head
  view.dispatch({ changes: { from: pos, insert: `${ph}\n` } })
  const finish = (link: string | null): void => {
    const full = view.state.doc.toString()
    const i = full.indexOf(ph)
    if (i < 0) return // 占位符被用户删除:静默放弃
    view.dispatch({
      changes: { from: i, to: i + ph.length + 1, insert: link === null ? '' : `${link}\n` }
    })
  }
  return run(finish)
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
  const { dir, assetsDir } = assetsDirFor(docPath)
  const stamp = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(
    stamp.getDate()
  )}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`

  let failed = false
  for (const [i, file] of files.entries()) {
    const name = `IMG_${ts}${files.length > 1 ? `_${i + 1}` : ''}.${fileExt(file.type)}`
    const buf = new Uint8Array(await file.arrayBuffer())
    // 占位符立即上屏;上传/落盘完成后原地替换(图床失败回退本地链接)
    await withUploadingPlaceholder(view, async (finish) => {
      const link = await persistImage({ name, type: file.type }, buf, docPath)
      if (link) finish(link)
      else {
        finish(null)
        failed = true
      }
    })
  }
  if (!ui.upload.enabled && !failed) {
    ui.showToast(t('editor.imagesInserted', { n: files.length, dir: assetsDir }))
  }
  return true
}

/** 块工具栏「插入图片」：原生文件选择器 → 图床/复制进 .assets → 插入链接 */
async function insertImageFromDisk(): Promise<void> {
  if (!view) return
  const tab = docs.tabs.find((t) => t.id === tabId)
  if (!tab?.path) {
    ui.showToast(t('editor.saveFirstForImage'))
    return
  }
  const src = await window.api.dialog.openImage()
  if (!src) return
  const docPath = tab.path
  const { dir, assetsDir } = assetsDirFor(docPath)
  const name = src.split(/[\\/]/).pop() ?? 'image'
  // 主进程读（base64 中转），上传或落盘都在这条链路上
  let base64: string
  try {
    base64 = await window.api.fs.readBinary(src)
  } catch (err) {
    console.error('[editor] image read failed:', err)
    ui.showToast(t('editor.imageSaveFailed', { name }))
    return
  }
  const type = mimeFromName(name)
  const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  await withUploadingPlaceholder(view, async (finish) => {
    const link = await persistImage({ name, type }, buf, docPath)
    if (link) finish(`${link}\n`)
    else finish(null)
  })
  if (!ui.upload.enabled) ui.showToast(t('editor.imagesInserted', { n: 1, dir: assetsDir }))
  view.focus()
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
  // 先接管粘贴（preventDefault 必须同步做），转换器惰性加载后异步落稿；
  // 转换失败/无价值时回退插入纯文本
  event.preventDefault()
  void (async () => {
    const md = await htmlToMarkdown(html)
    const insert = md !== null && md !== plain.trim() ? md : plain
    if (!insert) return
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert }, scrollIntoView: true })
  })()
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

/* ---------- 图片行检测与尺寸/对齐操作（工具条第三上下文） ---------- */

function updateImageInfo(): void {
  if (!view || tableInfo.value) {
    imageInfo.value = null
    return
  }
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  // 行内只有图片（允许前后空白）才算图片上下文：避免行内图文混排时格式按钮消失
  imageInfo.value = /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/.test(line.text) ? parseImageLine(line.text) : null
}

/* ---------- 双栏联动：光标在图片语法上 → 预览对应图高亮 ---------- */

/** 图片语法（行内式与引用式）；光标落点含起止符 */
const IMG_SYNTAX_RE = /!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/g

let lastImgFocusSig = ''

/** 光标所在图片语法 → (1 基行号, 行内第几张)。经 EditorArea 转给 Preview
 *  高亮对应图（同段多图按行内出现序区分）；光标不在图片上发 null 撤高亮。
 *  只在签名变化时发,打字/移动光标的高频调用无副作用 */
function updateImageFocus(state: EditorState): void {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  IMG_SYNTAX_RE.lastIndex = 0
  let hit = -1
  let idx = 0
  let m: RegExpExecArray | null
  while ((m = IMG_SYNTAX_RE.exec(line.text))) {
    const from = line.from + m.index
    if (pos >= from && pos <= from + m[0].length) {
      hit = idx
      break
    }
    idx++
  }
  const sig = hit >= 0 ? `${line.number}:${hit}` : ''
  if (sig === lastImgFocusSig) return
  lastImgFocusSig = sig
  emit('image-focus', hit >= 0 ? line.number : null, hit)
}

/* 重进双栏时强制重发一次（离开期间高亮已被清,签名去重会挡住重发） */
watch(
  () => ui.editorMode,
  (m) => {
    if (m === 'split' && view) {
      lastImgFocusSig = ''
      updateImageFocus(view.state)
    }
  }
)

/** 用新修饰符重写光标行（单事务，可撤销），保持光标在行内 */
function runImageMods(next: ImageMods | ((cur: ImageMods) => ImageMods)): void {
  if (!view || !imageInfo.value) return
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const applied = applyImageMods(line.text, typeof next === 'function' ? next(imageInfo.value.mods) : next)
  if (applied === line.text) return
  const head = view.state.selection.main.head
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: applied },
    selection: { anchor: Math.min(line.from + applied.length, Math.max(line.from, head - line.from + (applied.length - line.text.length))) }
  })
  view.focus()
}

function runCmd(cmd: Command): void {
  if (!view) return
  cmd(view)
  view.focus()
}

/** 在光标处插入片段并把光标放到 cursorOffset（相对插入起点的偏移）。
 *  块级片段（表格/围栏）保证落在独立行：行中插入先断行、片段后补换行，
 *  避免模板挤进段落里导致语法失效 */
function insertSnippet(text: string, cursorOffset: number, isBlock = false): void {
  if (!view) return
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const prefix = isBlock && pos > line.from ? '\n' : ''
  const suffix = isBlock ? '\n' : ''
  view.dispatch({
    changes: { from: pos, insert: prefix + text + suffix },
    selection: { anchor: pos + prefix.length + cursorOffset },
    scrollIntoView: true
  })
  view.focus()
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
  // 启动即开着 Vim 模式：动态加载后挂载（首次引入 lib 再缓存）
  if (ui.vimMode) void syncVim(true)
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

/* ---------- 查找替换（自建停靠条驱动 CM6 SearchQuery；内置面板无计数已弃用） ---------- */

const findBarOpen = ref(false)
const findQuery = ref<FindQuery>({ text: '', caseSensitive: false, regexp: false, wholeWord: false })
const findReplaceText = ref('')
const findCount = ref(0)
const findActive = ref(-1)
const findError = ref(false)
const findBarRef = ref<InstanceType<typeof FindBar> | null>(null)

function regexInvalid(q: FindQuery): boolean {
  if (!q.regexp) return false
  try {
    new RegExp(q.text, q.caseSensitive ? '' : 'i')
    return false
  } catch {
    return true
  }
}

function cmQuery(q: FindQuery): SearchQuery {
  return new SearchQuery({
    search: q.text,
    replace: findReplaceText.value,
    caseSensitive: q.caseSensitive,
    regexp: q.regexp,
    // 正则模式下全字匹配由用户自写 \b（与 VS Code 一致）
    wholeWord: q.wholeWord && !q.regexp
  })
}

/** 应用查询到 CM 搜索状态（导航/替换命令用）与高亮器（自带高亮要求面板打开，弃用） */
function applySearchQuery(navigate: boolean): void {
  if (!view) return
  const q = findQuery.value
  const cmq = cmQuery(q)
  view.dispatch({
    effects: [setSearchQuery.of(cmq), setLuciFindQuery.of(regexInvalid(q) ? null : cmq)]
  })
  findError.value = regexInvalid(q)
  if (navigate && q.text && !findError.value) findNext(view)
  recountMatches()
}

/** 全文计数（SearchCursor 迭代）+ 以光标为界算当前序号 */
function recountMatches(): void {
  if (!view) return
  const q = findQuery.value
  findError.value = regexInvalid(q)
  if (!q.text || findError.value) {
    findCount.value = 0
    findActive.value = -1
    return
  }
  const cursor = cmQuery(q).getCursor(view.state.doc)
  const head = view.state.selection.main.head
  let total = 0
  let before = 0
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    const hit = r.value as { from: number; to: number }
    if (hit.to <= head) before++
    total++
  }
  findCount.value = total
  findActive.value = total ? Math.min(before - 1, total - 1) : -1
}

function openFindUi(): void {
  if (!view) return
  const main = view.state.selection.main
  if (!main.empty && main.to - main.from <= 200) {
    const text = view.state.sliceDoc(main.from, main.to)
    if (text && !text.includes('\n')) findQuery.value = { ...findQuery.value, text }
  }
  findBarOpen.value = true
  applySearchQuery(true)
  void nextTick(() => findBarRef.value?.focusInput())
}

function closeFindUi(): void {
  findBarOpen.value = false
  // 清查询 = 清除正文里的命中高亮
  if (view) {
    view.dispatch({
      effects: [setSearchQuery.of(new SearchQuery({ search: '' })), setLuciFindQuery.of(null)]
    })
  }
}

function findNav(dir: 1 | -1): void {
  if (!view) return
  if (dir === 1) findNext(view)
  else findPrevious(view)
  recountMatches()
}

function doFindReplace(): void {
  if (!view || !findQuery.value.text || findError.value) return
  replaceNext(view)
  recountMatches()
}

function doFindReplaceAll(): void {
  if (!view || !findQuery.value.text || findError.value) return
  cmReplaceAll(view)
  recountMatches()
}

watch(findQuery, () => {
  if (findBarOpen.value) applySearchQuery(true)
})

watch(findReplaceText, () => {
  if (findBarOpen.value) applySearchQuery(false)
})

/* 菜单 Ctrl+F → 打开停靠查找条（仅源码可见时；即显模式由 WysiwygEditor 处理） */
watch(
  () => ui.findRequest,
  () => {
    if (view && (ui.editorMode === 'edit' || ui.editorMode === 'split')) openFindUi()
  }
)

/* 大纲点击跳转：光标落行，目标行定位到视口上方（贴近阅读习惯，顶部留一点边距） */
watch(
  () => ui.jumpLine,
  (j) => {
    if (!view || !j) return
    const ln = Math.min(Math.max(1, j.line), view.state.doc.lines)
    const pos = view.state.doc.line(ln).from
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 100 })
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
/* Vim 模式热切换（懒加载扩展体） */
watch(() => ui.vimMode, (on) => void syncVim(on))

/* 语言切换：CodeMirror 内置界面短语热替换 */
watch(
  () => ui.localePref,
  () => view?.dispatch({ effects: phrasesComp.reconfigure(cmPhrases()) })
)
</script>

<template>
  <div class="cm-host-wrap">
    <!-- 查找条：停靠在编辑区最顶部（工具条之上），不遮挡正文 -->
    <FindBar
      v-if="findBarOpen"
      ref="findBarRef"
      :query="findQuery"
      :replace="findReplaceText"
      :count="findCount"
      :active="findActive"
      :error="findError"
      @update:query="findQuery = $event"
      @update:replace="findReplaceText = $event"
      @nav="findNav"
      @replace="doFindReplace"
      @replace-all="doFindReplaceAll"
      @close="closeFindUi"
    />
    <!-- 停靠工具条：固定在编辑区顶部，不浮动、不遮挡正文。
         光标在表格内 → 表格结构操作；否则 → 常用格式化操作（作用于选区/光标行） -->
    <div class="ctx-strip" @mousedown.prevent>
      <template v-if="tableInfo">
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
      </template>
      <template v-else-if="imageInfo">
        <!-- 图片上下文：宽度步进 + 三档对齐 + 清除修饰 -->
        <span class="ctx-hint">图片 · {{ widthLabel(imageInfo.mods) }}</span>
        <i class="tb-sep" />
        <button :title="$t('img.wider')" @click="runImageMods((c) => stepWidth(c, 1))">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="3" width="11" height="8" rx="1.5"/><path d="M7 5.5v3M5.75 6.75 7 5.5l1.25 1.25"/></svg>
        </button>
        <button :title="$t('img.narrower')" @click="runImageMods((c) => stepWidth(c, -1))">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="3" width="11" height="8" rx="1.5"/><path d="M7 5.5v3M5.75 7.25 7 8.5l1.25-1.25"/></svg>
        </button>
        <i class="tb-sep" />
        <button :title="$t('img.alignLeft')" @click="runImageMods((c) => ({ ...c, align: 'left' }))">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="1.5" y="3.5" width="7" height="7" rx="1"/><path d="M1.5 1.5h11M1.5 12.5h11"/></svg>
        </button>
        <button :title="$t('img.alignCenter')" @click="runImageMods((c) => ({ ...c, align: 'center' }))">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1"/><path d="M1.5 1.5h11M1.5 12.5h11"/></svg>
        </button>
        <button :title="$t('img.alignRight')" @click="runImageMods((c) => ({ ...c, align: 'right' }))">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="5.5" y="3.5" width="7" height="7" rx="1"/><path d="M1.5 1.5h11M1.5 12.5h11"/></svg>
        </button>
        <i class="tb-sep" />
        <button :title="$t('img.resetMods')" @click="runImageMods({})">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7a5 5 0 1 1 1.5 3.5M2 7V4m0 3h3"/></svg>
        </button>
      </template>
      <template v-else>
        <button :title="$t('block.bold')" @click="runCmd(cmdBold)"><span class="glyph glyph-b">B</span></button>
        <button :title="$t('block.italic')" @click="runCmd(cmdItalic)"><span class="glyph glyph-i">I</span></button>
        <button :title="$t('block.strike')" @click="runCmd(cmdStrike)"><span class="glyph glyph-s">S</span></button>
        <button :title="$t('block.code')" @click="runCmd(cmdInlineCode)">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 4 1.5 7l3 3M9.5 4l3 3-3 3" /></svg>
        </button>
        <button :title="$t('block.highlight')" @click="runCmd(cmdHighlight)">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 11.5h9M8.8 2.2l2.5 2.5-5.4 5.4-3 .5.5-3z" /></svg>
        </button>
        <button :title="$t('block.link')" @click="runCmd(cmdLink)">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 8 2L7.2 2.8M8 6a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 6 12l.8-.8" /></svg>
        </button>
        <i class="tb-sep" />
        <button :title="$t('block.headingUp')" @click="runCmd(cmdHeadingUp)">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 11.5V4.5M2 4.5L1 6M2 4.5L3 6" /><text x="5" y="10.5" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">H</text></svg>
        </button>
        <button :title="$t('block.headingDown')" @click="runCmd(cmdHeadingDown)">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5v7M2 11.5l-1-1.5M2 11.5L3 10" /><text x="5" y="10.5" font-size="8.5" font-weight="700" fill="currentColor" stroke="none" font-family="inherit">H</text></svg>
        </button>
        <i class="tb-sep" />
        <button :title="$t('block.insertTable')" @click="insertSnippet('| 列1 | 列2 |\n| --- | --- |\n|  |  |', 2, true)">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="1.5" y="2.5" width="11" height="9" rx="1" /><path d="M1.5 5.7h11M1.5 8.4h11M5 5.7v5.8M9 5.7v5.8" /></svg>
        </button>
        <button :title="$t('block.insertCode')" @click="insertSnippet('```\n\n```', 4, true)">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M4 4.5 2 7l2 2.5M10 4.5 12 7l-2 2.5" /><path d="M8.2 3l-2.4 8" /></svg>
        </button>
        <button :title="$t('block.insertImage')" @click="insertImageFromDisk">
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" /><circle cx="5" cy="5.8" r="1" /><path d="M12.5 9.5 9.6 6.6l-5 4.9" /></svg>
        </button>
      </template>
    </div>
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

/* 停靠工具条：编辑区顶部固定（非浮动），内容随光标上下文切换（表格/格式化）。
   窄窗口放不下时换行摊开，绝不裁切按钮（此前横向滚动条隐藏、尾部按钮被截半） */
.ctx-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1px;
  padding: 3px 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tb-size {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-2);
  padding: 0 5px;
  flex-shrink: 0;
}

.tb-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 4px;
  flex-shrink: 0;
}

.ctx-strip button {
  width: 26px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  color: var(--text-2);
  flex-shrink: 0;
}

.ctx-strip button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.ctx-strip button.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.ctx-strip button:disabled {
  opacity: 0.35;
  cursor: default;
}

/* 文本字形图标（B/I/S，WPS 习惯）：衬线感弱化，直接用字重/字形表达 */
.glyph {
  font-family: var(--font-serif);
  font-size: 13px;
  line-height: 1;
}

.glyph-b {
  font-weight: 700;
}

.glyph-i {
  font-style: italic;
  font-family: Georgia, 'Times New Roman', serif;
}

.glyph-s {
  text-decoration: line-through;
}

/* 图片上下文的当前状态提示（宽度值） */
.ctx-hint {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-2);
  padding: 0 5px;
  flex-shrink: 0;
  white-space: nowrap;
}
</style>

<style>
/* 查找命中高亮（自建高亮器 + CM 内置类双保险），琥珀系与即显/预览一致 */
.cm-editor .cm-searchMatch,
.cm-editor .cm-luci-find-hit {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 2px;
}

.cm-editor .cm-searchMatch-selected,
.cm-editor .cm-luci-find-hit-active {
  background: color-mix(in srgb, var(--accent) 62%, transparent);
  box-shadow: 0 0 0 1px var(--accent-strong);
}
</style>
