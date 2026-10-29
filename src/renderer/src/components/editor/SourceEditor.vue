<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightActiveLine,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  type Command,
  type ViewUpdate
} from '@codemirror/view'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap
} from '@codemirror/autocomplete'
import {
  foldKeymap,
  indentOnInput,
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle
} from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  search,
  highlightSelectionMatches,
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll as cmReplaceAll
} from '@codemirror/search'
import { luciFindHighlight, setLuciFindQuery } from '@/editor/cm-find-highlight'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { luciTheme, luciFoldGutter } from '@/editor/cm-theme'
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
  cmdHeadingDown,
  cmdListIndent,
  cmdListOutdent,
  autoRenumberFollowingList
} from '@/editor/cm-commands'
import { luciFocusMode, luciTypewriterMode } from '@/editor/cm-focus'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import type { FindQuery } from '@/find-shared'
import FindBar from './FindBar.vue'
import { htmlToMarkdown } from '@/services/richPaste'
import { isHttpUrl, linkTextFromSelection } from '@/editor/paste-link'
import { insertImageFiles, insertImageFromDisk } from '@/editor/insert-image'
import { cmSpellcheck } from '@/editor/cm-spellcheck'
import { t } from '@/i18n'
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
import { registerCmView } from '@/editor/cm-registry'
import { fenceCompletion } from '@/editor/cm-fence-completion'
import { emojiShortcodeSource } from '@/editor/cm-emoji-completion'
import { findState, sameQuery } from '@/editor/find-state'
import { saveViewProgress, saveViewCursor, clearViewAnchor, loadView } from '@/editor/tab-view-state'

const emit = defineEmits<{
  (e: 'scroll-sync', line: number, frac: number, edge: ScrollEdge): void
  (e: 'image-focus', line: number | null, k: number): void
}>()

/** 滚动到顶/底的显式信号：两侧视口高度不同，「行贴顶」模型到不了同一端点 */
type ScrollEdge = 'top' | 'bottom' | null

const ui = useUiStore()
const docs = useDocumentsStore()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let unregisterCm: (() => void) | null = null
let renumberDebounce = -1
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
/** 拼写检查装饰（4.2 自研引擎）按需装卸 */
const spellComp = new Compartment()

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
      // 显式组装基础扩展（替代 basicSetup）：组成一致，折叠 gutter 换自定义
      // 圆角 chevron（luciFoldGutter）；lint 键位未纳入（项目无 lint 扩展）
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      luciFoldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      // ``` 语言补全 + :emoji: 短代码补全（候选列表；fence 源附 Enter 自动收尾围栏）
      ...fenceCompletion(emojiShortcodeSource),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        // searchKeymap 不挂载：其 Mod-f 会打开 CM 内置搜索面板（与应用查找条重复，
        // 且焦点不在编辑器时按 Ctrl+F 也会弹出）。查找/替换统一走应用查找条，
        // findNext/replaceNext 等命令依赖的 search 状态由下方 search() 提供
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [yamlFrontmatter] }),
      search({ top: true }),
      luciFindHighlight(),
      phrasesComp.of(cmPhrases()),
      keymap.of([
        // 列表行 Tab 降级 / Shift+Tab 升级（Typora 习惯）；非列表行交回 indentWithTab
        { key: 'Tab', run: cmdListIndent },
        { key: 'Shift-Tab', run: cmdListOutdent },
        indentWithTab,
        ...formattingKeymap
      ]),
      luciTheme,
      focusComp.of(ui.focusMode ? luciFocusMode : []),
      typewriterComp.of(ui.typewriterMode ? luciTypewriterMode : []),
      spellComp.of(ui.editorPrefs.spellcheck ? cmSpellcheck : []),
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
        // 源码实时重排：空行分隔的后续有序组从 1 起（与预览渲染语义一致）；
        // 组合输入（IME）期间立即重排会打断输入，推迟到防抖窗口收敛
        if (u.docChanged && !u.view.composing) {
          autoRenumberFollowingList(u.view, u.state.selection.main.head)
        }
        if (u.docChanged) {
          window.clearTimeout(renumberDebounce)
          renumberDebounce = window.setTimeout(() => {
            if (view && !view.composing) autoRenumberFollowingList(view, view.state.selection.main.head)
          }, 350)
        }
        if (u.docChanged || u.selectionSet) {
          ui.currentLine = u.state.doc.lineAt(u.state.selection.main.head).number
          ui.caretSeq++
        }
      }),
      EditorView.domEventHandlers({
        paste: (event, view) => handlePaste(event, view),
        drop: (event, view) => void insertImageFiles(event.dataTransfer, view, event)
      })
    ]
  })
}

/* ---------- 图片粘贴/拖拽/插入 → 共享链路见 editor/insert-image.ts ---------- */

/**
 * 粘贴分流：URL + 有选区 → 包成链接；图片文件 → 自动落盘；
 * 富文本（text/html）→ 转 Markdown；其余（纯文本）→ 编辑器默认粘贴。
 * 返回 true 表示已接管该事件。
 */
function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
  const dt = event.clipboardData
  if (!dt) return false
  // 粘贴 http(s) URL 且有选区 → [选中文本](URL)（优先于 html 分流：地址栏复制
  // 常带 text/html 载荷，走转换会把选区覆盖成 URL 文本自身）
  const url = (dt.getData('text/plain') ?? '').trim()
  const selMain = view.state.selection.main
  if (isHttpUrl(url) && !selMain.empty) {
    const text = linkTextFromSelection(view.state.sliceDoc(selMain.from, selMain.to))
    if (text) {
      event.preventDefault()
      view.dispatch({
        changes: { from: selMain.from, to: selMain.to, insert: `[${text}](${url})` },
        scrollIntoView: true
      })
      return true
    }
  }
  if ([...dt.files].some((f) => f.type.startsWith('image/'))) {
    void insertImageFiles(dt, view, event)
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

/* 编辑器滚动 → 通知预览：视口顶行的行号（setTimeout 节流，不依赖渲染帧）。
   行号带亚行小数（顶行内已滚过的像素比例）：预览按它做亚行插值。图片密集区
   左右行高差异巨大（左 ~20px/行、右一整张图），整数行号会让预览一格格跳图片 */
let scrollPending = false
/** 上次同步过的事件位置：内容变高/回车等布局变化也会派发 scroll 事件但
 *  scrollTop 未动，若当成「滚到顶部」会把预览强行拉回 0（表现为闪跳） */
let syncedScrollTop = -1
function onScrollDom(): void {
  if (Date.now() < lockUntil || scrollPending) return
    scrollPending = true
  window.setTimeout(() => {
    scrollPending = false
    // 排队期间若刚发生过程序同步，丢弃本次陈旧行号，避免回声
    if (!view || Date.now() < lockUntil) return
    const sd = view.scrollDOM
    if (sd.scrollTop === syncedScrollTop) return
    syncedScrollTop = sd.scrollTop
    // 顶/底边缘发显式信号（编辑器底部有 40vh 内边距，「滚到底」时
    // 视口顶行远小于末行，插值模型无法把预览也带到同一端点）
    if (sd.scrollTop + sd.clientHeight >= sd.scrollHeight - 4) {
      emit('scroll-sync', Number.MAX_SAFE_INTEGER, 0, 'bottom')
      return
    }
    if (sd.scrollTop <= 2) {
      emit('scroll-sync', 0, 0, 'top')
      return
    }
    const rect = sd.getBoundingClientRect()
    // posAtCoords 接收视口（client）坐标：取文本区中部、视口顶下方 4px
    const pos = view.posAtCoords({ x: rect.left + sd.clientWidth * 0.4, y: rect.top + 4 })
    const lineObj =
      pos !== null
        ? view.state.doc.lineAt(pos)
        : view.state.doc.lineAt(view.state.selection.main.head)
    const content = sd.querySelector<HTMLElement>('.cm-content')
    const block = view.lineBlockAt(lineObj.from)
    const blockTop = block.top + (content?.offsetTop ?? 0)
    const frac =
      block.height > 0 ? Math.min(0.999, Math.max(0, (sd.scrollTop - blockTop) / block.height)) : 0
    // 浏览进度（全模式共享）：滚动即写入
    if (tabId !== null) {
      saveViewProgress(
        tabId,
        sd.scrollTop / Math.max(1, sd.scrollHeight - sd.clientHeight)
      )
      // CM 滚走后预览的旧内容锚不再反映当前位置（双栏联动不重写锚），
      // 失效之——否则切到预览模式按旧锚落位（实测漂移可达 45%）
      clearViewAnchor(tabId)
    }
    emit('scroll-sync', lineObj.number + frac, 0, null)
  }, 16)
}

/* 预览滚动 → 同步编辑器：
   直接按高度图估算设置 scrollTop（不依赖渲染帧），再让 scrollIntoView 在
   可见环境下用精确测量修正。两者目标一致（该行贴视口顶），不会互相打架。 */
function syncToLine(line: number, _frac: number, edge: ScrollEdge = null): void {
  if (!view) return
  const sd = view.scrollDOM
  lockUntil = Date.now() + 120
  if (edge === 'bottom') {
    sd.scrollTop = sd.scrollHeight
    return
  }
  if (edge === 'top') {
    sd.scrollTop = 0
    return
  }
  const ln = Math.min(Math.max(1, Math.round(line)), view.state.doc.lines)
  const pos = view.state.doc.line(ln).from
  const content = sd.querySelector<HTMLElement>('.cm-content')
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
  // 挂载即聚焦：新文档/空文档下格式化快捷键（Ctrl+1..6 等）直达编辑器，
  // 不必先点一下编辑区（与即显侧挂载聚焦同款语义）
  view.focus()
  unregisterCm = registerCmView(view)
  tabId = docs.activeId
  pullFind(docs.activeId, true) // 恢复本标签共享的查找条状态（视图刚建，无条件重亮）
  view.scrollDOM.addEventListener('scroll', onScrollDom, { passive: true })
  // 点击编辑区任意位置（含内边距/行号间隙）都要拿到焦点，避免"点了但打不了字"
  host.value.addEventListener('mousedown', onHostMousedown)
  // 拼写检查开关（4.2）：按设置应用 + 跟随设置切换广播
  applySpellcheckAttr(ui.editorPrefs.spellcheck ? 'true' : 'false')
  window.addEventListener('inkbox:spellcheck', onSpellcheckBroadcast)
  // 启动即开着 Vim 模式：动态加载后挂载（首次引入 lib 再缓存）
  if (ui.vimMode) void syncVim(true)
})

function applySpellcheckAttr(v: string): void {
  view?.contentDOM.setAttribute('spellcheck', v)
}

function onSpellcheckBroadcast(e: Event): void {
  applySpellcheckAttr((e as CustomEvent<string>).detail ?? 'false')
  // 自研拼写装饰随开关装卸（引擎懒加载后由就绪回调再触发一次重配置）
  void import('@/editor/cm-spellcheck').then((m) => {
    view?.dispatch({
      effects: spellComp.reconfigure(ui.editorPrefs.spellcheck ? m.cmSpellcheck : [])
    })
  })
}

function onHostMousedown(): void {
  if (view && !view.hasFocus) view.focus()
}

onBeforeUnmount(() => {
  pushFind() // 卸载前最后推一次（正常情况下每次变化都已实时推送，这里是兜底）
  host.value?.removeEventListener('mousedown', onHostMousedown)
  window.removeEventListener('inkbox:spellcheck', onSpellcheckBroadcast)
  view?.scrollDOM.removeEventListener('scroll', onScrollDom)
  unregisterCm?.()
  view?.destroy()
  view = null
})

/* 切换标签：整档替换（M1 不保留每标签 undo 栈），并恢复该标签的浏览进度与光标 */
watch(
  () => docs.activeId,
  (id, old) => {
    if (!view || id === null) return
    const cm = view // 闭包用局部常量：定时器回调解耦可空的外部 let
    window.clearTimeout(renumberDebounce) // 上一标签排队的重排不在新文档上执行
    // 旧标签落袋：滚动进度 + 光标。隐藏窗格（预览模式下源码 v-show 隐藏）
    // scrollTop 恒 0，进度跳过保存保留旧值；光标仍要落袋
    if (host.value && host.value.offsetParent !== null) {
      const sd = cm.scrollDOM
      saveViewProgress(old, sd.scrollTop / Math.max(1, sd.scrollHeight - sd.clientHeight))
      // 锚点只在预览可见时新鲜：旧标签不是双栏（预览没跟着动）即过期，
      // 清掉防止下次双栏恢复按旧锚点落位（两窗格各恢复各的位置）
      const oldTab = docs.tabs.find((t) => t.id === old)
      if (oldTab?.mode !== 'split') clearViewAnchor(old)
    }
    saveViewCursor(old, cm.state.selection.main.head)
    applying = true
    cm.setState(makeState(docs.active?.content ?? ''))
    tabId = id
    ui.currentLine = 1
    applying = false
    const saved = loadView(id)
    const cursor = saved?.cursor
    const len = cm.state.doc.length
    pullFind(id, true) // 无条件恢复（视图刚重建，高亮需要重亮）
    if (cm.hasFocus) cm.contentDOM.blur() // 摘焦点，减少光标自动滚动诱因
    applyLanding()
    if (cursor !== undefined && cursor <= len) {
      cm.dispatch({ selection: { anchor: cursor } }) // 不带 scrollIntoView，不打扰落位
    }
  }
)

/** 落位 rAF 短钉句柄（0 = 无钉） */
let landingPin = 0

/** 计算落位目标（applyLanding 与短钉共用）：整档替换后高度图是估算值，
 *  首帧测量后 scrollHeight 会变——目标必须按当前高度图现算，不能冻结 */
function landingTarget(): number {
  if (!view) return 0
  const cm = view
  const sd = cm.scrollDOM
  const saved = loadView(docs.activeId)
  const a = ui.editorMode === 'split' ? saved?.anchor : undefined
  if (a?.kind === 'block' && (a.line ?? 0) > 0) {
    const ln = Math.min(Math.max(1, Math.round(a.line ?? 1)), cm.state.doc.lines)
    const pos = cm.state.doc.line(ln).from
    const content = sd.querySelector<HTMLElement>('.cm-content')
    const block = cm.lineBlockAt(pos)
    return Math.max(0, block.top + (content?.offsetTop ?? 0) - 6)
  }
  if (a?.kind === 'bottom') return sd.scrollHeight
  if (a?.kind === 'top') return 0
  return saved ? saved.frac * Math.max(0, sd.scrollHeight - sd.clientHeight) : 0
}

/** 按共享进度落位（切签与进入源码可见模式共用）：
 *  双栏优先预览写下的内容锚（行号落位，与预览同一事实来源——frac 在双栏
 *  下由两窗格交替写入，语义会漂移成「预览在 1.3.2、编辑器在结尾」这种走散）；
 *  锚点缺失/过期（编辑、即显离开时已清）回退 frac 比例，无记录回顶。
 *  行号落位后补一发 scrollIntoView：heightMap 在可见后才实测，按精确值再对齐 */
function applyLanding(): void {
  if (!view) return
  const cm = view
  const sd = cm.scrollDOM
  const saved = loadView(docs.activeId)
  const a = ui.editorMode === 'split' ? saved?.anchor : undefined
  if (a?.kind === 'block' && (a.line ?? 0) > 0) {
    const ln = Math.min(Math.max(1, Math.round(a.line ?? 1)), cm.state.doc.lines)
    const pos = cm.state.doc.line(ln).from
    cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 6 }) })
  }
  sd.scrollTop = landingTarget()
  lockUntil = Date.now() + 150
  // CM 在 setState 后首次测量会按实测高度补偿滚动位置（估算偏短时一帧内
  // 往下顶几百 px），且切签瞬间高度图未实测、比例目标本身偏短——rAF 短钉：
  // 每帧按最新高度图重算目标并钉回，连续 3 帧稳定或 700ms 即撤；
  // 钉回后当帧又被改走视为用户在滚，立即放手。钉帧期间压住 lockUntil，
  // 程序性滚动不落袋（否则中间值毒化 frac）
  cancelAnimationFrame(landingPin)
  let stable = 0
  let corrections = 0
  const start = Date.now()
  const tick = (): void => {
    lockUntil = Math.max(lockUntil, Date.now() + 80)
    const target = landingTarget()
    const cur = sd.scrollTop
    if (Math.abs(cur - target) > 2) {
      // CM 测量补偿只纠正一两次；连续被改走是用户在滚（滚轮是连续事件），
      // 超过预算立即放手
      if (++corrections > 3) return
      sd.scrollTop = target
      stable = 0
    } else {
      if (++stable >= 3 || Date.now() - start > 700) return
    }
    landingPin = requestAnimationFrame(tick)
  }
  landingPin = requestAnimationFrame(tick)
}

/* ---------- 查找替换（自建停靠条驱动 CM6 SearchQuery；内置面板无计数已弃用） ---------- */

/** 查找状态按「标签」共享（同一文档四模式一份）：refs 当前属于哪个标签 */
const findTabId = ref<number | null>(null)
/** 拉回槽位期间抑制查询/替换 watcher 的自动应用（拉回自己做显式重亮，不导航） */
let findSyncing = false

/** refs → 标签槽（每次变化即写；值相同直接跳过，天然覆盖切标签/卸载的“保存”） */
function pushFind(): void {
  const st = findState(findTabId.value)
  if (
    st.open === findBarOpen.value &&
    sameQuery(st.query, findQuery.value) &&
    st.replace === findReplaceText.value &&
    st.active === findActive.value
  ) {
    return
  }
  st.open = findBarOpen.value
  st.query = { ...findQuery.value }
  st.replace = findReplaceText.value
  st.active = findActive.value
}

/** 标签槽 → refs：切标签/挂载/双栏另一侧改了共享状态。force=无条件重亮（视图重建后） */
function pullFind(id: number | null, force = false): void {
  const wasOpen = findBarOpen.value
  const st = findState(id)
  if (
    !force &&
    st.open === findBarOpen.value &&
    sameQuery(st.query, findQuery.value) &&
    st.replace === findReplaceText.value &&
    st.active === findActive.value
  ) {
    findTabId.value = id
    return
  }
  findTabId.value = id
  findSyncing = true
  findBarOpen.value = st.open
  findQuery.value = { ...st.query }
  findReplaceText.value = st.replace
  if (view) {
    if (st.open) {
      applySearchQuery(false) // 只重亮高亮+计数，不跳转导航
      // 恢复原来的活动项（x/x 显示）：recount 按光标算的，覆盖为存的序号（钳到有效范围）
      if (findCount.value > 0) {
        findActive.value = Math.min(Math.max(st.active, 0), findCount.value - 1)
      }
    } else if (wasOpen) {
      view.dispatch({
        effects: [setSearchQuery.of(new SearchQuery({ search: '' })), setLuciFindQuery.of(null)]
      })
    }
  }
  void nextTick(() => {
    findSyncing = false
  })
}

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
  if (findSyncing) return // 拉回共享状态不是一次新查询，不导航不跳转
  if (findBarOpen.value) applySearchQuery(true)
})

watch(findReplaceText, () => {
  if (findSyncing) return
  if (findBarOpen.value) applySearchQuery(false)
})

/* refs → 共享槽位：查找条任何状态变化即推送（双栏另一侧/其他模式同步读取） */
watch([findBarOpen, findQuery, findReplaceText, findActive], () => {
  if (findSyncing) return
  pushFind()
})

/* 共享槽位 → refs：双栏另一侧（预览）或模式切换改了同一标签的查找状态 */
watch(
  () => {
    const st = findState(findTabId.value)
    return [st.open, st.query.text, st.query.caseSensitive, st.query.regexp, st.query.wholeWord, st.replace, st.active] as const
  },
  () => {
    if (findSyncing) return
    pullFind(findTabId.value)
  }
)

/* 菜单 Ctrl+F → 打开停靠查找条（仅源码可见时；即显模式由 WysiwygEditor 处理） */
watch(
  () => ui.findRequest,
  () => {
    if (view && (ui.editorMode === 'edit' || ui.editorMode === 'split')) openFindUi()
  }
)

/* 大纲点击跳转：光标落行，目标行定位到视口上方（贴近阅读习惯，顶部留一点边距）。
   跳转期间临时开 CSS 平滑滚动（scrollIntoView 的 scrollTop 赋值遵守 scroll-behavior），
   400ms 后收回——同步滚动（syncToLine 等）必须保持即时跟随，不能常开 */
watch(
  () => ui.jumpLine,
  (j) => {
    if (!view || !j) return
    const ln = Math.min(Math.max(1, j.line), view.state.doc.lines)
    const pos = view.state.doc.line(ln).from
    const sd = view.scrollDOM
    sd.style.scrollBehavior = 'smooth'
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 100 })
    })
    window.setTimeout(() => {
      if (sd.isConnected) sd.style.removeProperty('scroll-behavior')
    }, 400)
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

/* 模式切换后重新测量；从即显模式回到源码时，重同步 store 里的最新内容。
   进入源码可见模式时对齐共享浏览进度——即显/预览滚过的位置就是源码的位置 */
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
      // 面板可见后再落位（pre-flush 时机上 CM 还被 v-show 隐藏，scrollHeight=0，
      // 比例会写 0）；进度读取同样延迟——离开中的窗格（如即显卸载）的落袋
      // 保存发生在父组件渲染期间，watcher 触发时还没执行——此刻读会拿到上次
      // 的旧值甚至空值。多阶段补拍覆盖竞态；双栏按锚点行号落位（applyLanding）
      const applyFrac = (): void => {
        applyLanding()
      }
      void nextTick(applyFrac)
      window.setTimeout(applyFrac, 60)
      window.setTimeout(applyFrac, 250)
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
  /* 融进底色：停靠工具条不是卡片，仅留低对比细线与代码区分界 */
  background: transparent;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
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
