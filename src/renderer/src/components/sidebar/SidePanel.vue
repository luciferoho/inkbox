<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { SearchFileResult } from '@shared/types'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { useWorkspaceStore } from '@/stores/workspace'
import { t } from '@/i18n'
import { parseOutline, type OutlineItem } from '@/services/markdown'
import OutlineNode, { type OutlineTreeNode } from './OutlineNode.vue'
import FileTreeNode from './FileTreeNode.vue'

const ui = useUiStore()
const docs = useDocumentsStore()
const ws = useWorkspaceStore()

const outline = computed(() => parseOutline(docs.active?.content ?? ''))

/** 扁平标题 → 层级树 */
const outlineTree = computed<OutlineTreeNode[]>(() => {
  const roots: OutlineTreeNode[] = []
  const stack: OutlineTreeNode[] = []
  for (const it of outline.value) {
    const node: OutlineTreeNode = { ...it, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return roots
})

/** 折叠的标题节点（按行号）；默认全展开 */
const collapsed = reactive(new Set<number>())

function toggleNode(line: number): void {
  if (collapsed.has(line)) collapsed.delete(line)
  else collapsed.add(line)
}

/* ---------- 拖拽右缘调宽（window 级监听，双击手柄折叠） ---------- */

function onResizeStart(e: PointerEvent): void {
  if (e.button !== 0) return
  const startX = e.clientX
  const startWidth = ui.winPrefs.sidebarWidth
  const onMove = (ev: PointerEvent): void => {
    ui.resizeSidebarLive(startWidth + ev.clientX - startX)
  }
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    void ui.persistSidebarWidth()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/** 光标当前所在小节：最后一个 line <= currentLine 的标题（折叠不影响判定） */
const activeLine = computed(() => {
  let line = -1
  for (const h of outline.value) {
    if (h.line <= ui.currentLine) line = h.line
    else break
  }
  return line
})

async function openFolder(): Promise<void> {
  await ws.openFolder()
}

/** 关闭工作区：清空文件树（已打开的标签保留），会话快照同步清除文件夹记录 */
function closeWorkspace(): void {
  ws.closeFolder()
  ui.showToast(t('ws.closed'))
}

/* ---------- 全局搜索（工作区跨文件） ---------- */

const searchInput = ref<HTMLInputElement | null>(null)
const searchQuery = ref('')
const searchCase = ref(false)
const searchResults = ref<SearchFileResult[]>([])
const searchSearching = ref(false)
const searchTruncated = ref(false)
const searchScanned = ref(0)
/** 当前高亮用的查询词（结果返回时定格，避免输入中高亮闪变） */
const highlightQuery = ref('')

let searchTimer: number | undefined
let searchSeq = 0

watch([searchQuery, searchCase], () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void runSearch(), 300)
})

async function runSearch(): Promise<void> {
  const q = searchQuery.value.trim()
  if (!ws.root || !q) {
    searchSeq++
    searchResults.value = []
    highlightQuery.value = ''
    searchSearching.value = false
    return
  }
  const seq = ++searchSeq
  searchSearching.value = true
  try {
    const r = await window.api.search.run(ws.root, q, { caseSensitive: searchCase.value })
    if (seq !== searchSeq) return
    searchResults.value = r.files
    searchTruncated.value = r.truncated
    searchScanned.value = r.scanned
    highlightQuery.value = q
  } finally {
    if (seq === searchSeq) searchSearching.value = false
  }
}

/** 结果行安全高亮：按查询词切分成纯文本片段渲染（内容来自本地文件，不走 v-html） */
function splitHighlight(text: string): { seg: string; hit: boolean }[] {
  const q = highlightQuery.value
  if (!q) return [{ seg: text, hit: false }]
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const parts: { seg: string; hit: boolean }[] = []
  let i = 0
  while (i < text.length) {
    const hit = searchCase.value ? text.indexOf(q, i) : lower.indexOf(ql, i)
    if (hit < 0) {
      parts.push({ seg: text.slice(i), hit: false })
      break
    }
    if (hit > i) parts.push({ seg: text.slice(i, hit), hit: false })
    parts.push({ seg: text.slice(hit, hit + q.length), hit: true })
    i = hit + q.length
  }
  return parts
}

/** 点击结果：打开（或激活）文件后跳转到命中行 */
/* 切到搜索模式时自动聚焦输入框 */
watch(
  () => ui.sidebarMode,
  (mode) => {
    if (mode !== 'search') return
    void nextTick(() => searchInput.value?.focus())
  }
)

async function openAndJump(path: string, line: number): Promise<void> {
  const existing = docs.tabs.find((x) => x.path === path)
  if (existing) docs.activate(existing.id)
  else await docs.openPath(path)
  // 即显/纯预览没有可跳转的源码光标，先切回双栏
  if (ui.editorMode === 'wysiwyg' || ui.editorMode === 'preview') ui.setEditorMode('split')
  ui.jumpTo(line)
}

/* ---------- 文件树按名筛选 ---------- */

const treeFilter = ref('')

const filteredFiles = computed<string[]>(() => {
  const q = treeFilter.value.trim().toLowerCase()
  if (!q) return []
  return ws.allFiles.filter((p) => fileName(p).toLowerCase().includes(q))
})

function fileName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

function fileDir(p: string): string {
  const root = ws.root ?? ''
  const rel = (p.startsWith(root) ? p.slice(root.length) : p).replace(/^[\\/]+/, '')
  const sep = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'))
  return sep > 0 ? rel.slice(0, sep) : ''
}
</script>

<template>
  <aside class="panel">
    <div
      class="resize-handle"
      :title="$t('side.resizeHint')"
      @pointerdown="onResizeStart"
      @dblclick="ui.toggleSidebar()"
    />
    <div class="panel-head">
      <div class="segmented">
        <button :class="{ on: ui.sidebarMode === 'outline' }" @click="ui.setSidebarMode('outline')">
          {{ $t('side.outline') }}
        </button>
        <button :class="{ on: ui.sidebarMode === 'files' }" @click="ui.setSidebarMode('files')">
          {{ $t('side.files') }}
        </button>
        <button :class="{ on: ui.sidebarMode === 'search' }" @click="ui.setSidebarMode('search')">
          {{ $t('side.search') }}
        </button>
      </div>
      <button class="collapse-btn" :title="$t('side.collapse')" @click="ui.toggleSidebar()">
        <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M6.5 1.5L3 5l3.5 3.5" />
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <!-- 大纲 -->
      <template v-if="ui.sidebarMode === 'outline'">
        <div v-if="!docs.active" class="empty">
          <p>{{ $t('side.outlineEmpty') }}</p>
        </div>
        <div v-else-if="outline.length === 0" class="empty">
          <p>{{ $t('side.outlineNoHeadings') }}</p>
          <p class="hint-tip" v-html="$t('side.outlineHint')" />
        </div>
        <nav v-else class="outline">
          <OutlineNode
            v-for="node in outlineTree"
            :key="node.line"
            :node="node"
            :depth="1"
            :collapsed="collapsed"
            :active-line="activeLine"
            @toggle="toggleNode"
            @select="(line) => ui.jumpTo(line)"
          />
        </nav>
      </template>

      <!-- 文件树 -->
      <template v-else-if="ui.sidebarMode === 'files'">
        <div v-if="!ws.root" class="empty">
          <p>{{ $t('side.filesEmpty') }}</p>
          <button class="mini-btn" @click="openFolder">{{ $t('side.openFolder') }}</button>
        </div>
        <template v-else>
          <div class="ws-root" :title="ws.root">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
              <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
            </svg>
            <span class="ws-name">{{ ws.root.split(/[\\/]/).pop() }}</span>
            <span class="ws-acts" @click.stop>
              <button class="ws-act" :title="$t('side.newDoc')" @click="ws.beginCreate(ws.root, false)">
                <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                  <path d="M7 3v8M3 7h8" />
                </svg>
              </button>
              <button class="ws-act" :title="$t('side.newFolder')" @click="ws.beginCreate(ws.root, true)">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
                  <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
                  <path d="M10.5 8.5v5M8 11h5" stroke-linecap="round" />
                </svg>
              </button>
              <button class="ws-act" :title="$t('side.openOther')" @click="openFolder">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
                  <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
                  <path d="M10.5 9.5h5M13 7v5" stroke-linecap="round" />
                </svg>
              </button>
              <button class="ws-act" :title="$t('side.closeWs')" @click="closeWorkspace">
                <svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
                  <path d="M1 1l8 8M9 1L1 9" />
                </svg>
              </button>
            </span>
          </div>
          <div v-if="ws.draft && ws.draft.mode !== 'rename' && ws.draft.parentPath === ws.root" class="draft-row">
            <input
              :placeholder="ws.draft.mode === 'new-dir' ? $t('side.phFolder') : $t('side.phFile')"
              :value="ws.draft.value"
              autofocus
              @input="ws.draft && (ws.draft.value = ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="ws.commitDraft()"
              @keydown.esc="ws.cancelDraft()"
              @blur="ws.commitDraft()"
            />
          </div>
          <!-- 按文件名筛选：非空时以扁平列表代替目录树 -->
          <div class="tree-filter">
            <input v-model="treeFilter" class="tf-input" :placeholder="$t('side.filterPh')" spellcheck="false" />
            <button v-if="treeFilter" class="tf-clear" :title="$t('common.close')" @click="treeFilter = ''">✕</button>
          </div>
          <template v-if="treeFilter.trim()">
            <div v-if="filteredFiles.length === 0" class="empty">
              <p>{{ $t('side.filterNoHit') }}</p>
            </div>
            <div v-else class="tf-list">
              <button
                v-for="p in filteredFiles"
                :key="p"
                class="tf-item"
                :title="p"
                @click="docs.openPath(p)"
              >
                <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
                  <path d="M5 2.5h6l4 4v11H5z" />
                  <path d="M11 2.5v4h4" />
                </svg>
                <span class="tf-name">{{ fileName(p) }}</span>
                <span v-if="fileDir(p)" class="tf-dir">{{ fileDir(p) }}</span>
              </button>
            </div>
          </template>
          <template v-else>
            <FileTreeNode
              v-for="entry in ws.children[ws.root]"
              :key="entry.path"
              :entry="entry"
              :depth="1"
            />
          </template>
        </template>
      </template>

      <!-- 全局搜索 -->
      <template v-else>
        <div class="search-box">
          <input
            ref="searchInput"
            v-model="searchQuery"
            class="search-input"
            :placeholder="$t('side.searchPh')"
            spellcheck="false"
          />
          <button
            class="search-case"
            :class="{ on: searchCase }"
            :title="$t('side.searchCase')"
            @click="searchCase = !searchCase"
          >
            Aa
          </button>
        </div>
        <div v-if="!ws.root" class="empty">
          <p>{{ $t('side.searchNeedWs') }}</p>
        </div>
        <div v-else-if="searchSearching" class="empty">
          <p>{{ $t('side.searching') }}</p>
        </div>
        <div v-else-if="!searchQuery.trim()" class="empty">
          <p>{{ $t('side.searchHint') }}</p>
        </div>
        <div v-else-if="searchResults.length === 0" class="empty">
          <p>{{ $t('side.searchNoHit') }}</p>
        </div>
        <template v-else>
          <p class="search-stat">
            {{ $t('side.searchStat', { files: searchResults.length, scanned: searchScanned }) }}
            <template v-if="searchTruncated">· {{ $t('side.searchTruncated') }}</template>
          </p>
          <div class="search-list">
            <div v-for="f in searchResults" :key="f.path" class="search-file">
              <p class="sf-name" :title="f.path">{{ f.name }}</p>
              <button
                v-for="(mt, i) in f.matches"
                :key="i"
                class="sf-match"
                @click="openAndJump(f.path, mt.line)"
              >
                <span class="sf-line">{{ mt.line }}</span>
                <span class="sf-text">
                  <template v-for="(part, k) in splitHighlight(mt.text)" :key="k">
                    <mark v-if="part.hit">{{ part.seg }}</mark>
                    <template v-else>{{ part.seg }}</template>
                  </template>
                </span>
              </button>
            </div>
          </div>
        </template>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  position: relative;
  width: 100%;
  min-width: 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

/* 右缘拖拽手柄 */
.resize-handle {
  position: absolute;
  top: 0;
  right: -1px;
  width: 7px;
  height: 100%;
  z-index: 5;
  cursor: col-resize;
  background: transparent;
  transition: background 0.12s;
}

.resize-handle:hover {
  background: var(--accent-soft);
  box-shadow: inset 1px 0 0 var(--accent);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 8px 10px;
}

.segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-m);
  background: var(--surface-2);
  flex: 1;
  min-width: 0;
}

.segmented button {
  flex: 1;
  height: 24px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

.segmented button.on {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 2px rgba(38, 32, 25, 0.08);
}

.collapse-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  color: var(--text-2);
  flex-shrink: 0;
}

.collapse-btn:hover {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 16px;
  color: var(--text-2);
  font-size: 12px;
  text-align: center;
  line-height: 1.8;
}

.hint-tip {
  line-height: 2;
}

.outline {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 4px;
}

.ws-root {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: var(--radius-s);
  color: var(--text);
  font-weight: 600;
  font-size: 12.5px;
}

.ws-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 悬浮操作：绝对定位覆盖右缘（布局恒定不抖动），实色底保证文字不透出 */
.ws-acts {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 2px 2px 12px;
  background: var(--surface);
  border-radius: var(--radius-s);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}

.ws-root:hover .ws-acts {
  opacity: 1;
  pointer-events: auto;
}

.ws-act {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  color: var(--text-2);
  font-size: 11px;
  line-height: 1;
}

.ws-act:hover {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

/* 空态紧凑按钮（侧栏窄，不用全局大按钮） */
.mini-btn {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  transition: border-color 0.15s, background 0.15s;
}

.mini-btn:hover {
  border-color: var(--accent);
  background: var(--surface-2);
}

.draft-row {
  display: flex;
  padding: 2px 8px;
}

.draft-row input {
  flex: 1;
  min-width: 0;
  height: 23px;
  padding: 0 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  outline: none;
}

/* ---------- 全局搜索 ---------- */
.search-box {
  display: flex;
  gap: 6px;
  padding: 10px 12px 8px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.search-case {
  width: 34px;
  height: 30px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 600;
}

.search-case.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.search-stat {
  flex-shrink: 0;
  padding: 2px 14px 8px;
  font-size: 11px;
  color: var(--text-2);
}

.search-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 12px;
}

.search-file {
  margin-bottom: 10px;
}

.sf-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-match {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border-radius: var(--radius-s);
  text-align: left;
}

.sf-match:hover {
  background: var(--accent-soft);
}

.sf-line {
  flex-shrink: 0;
  min-width: 22px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-2);
}

.sf-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}

.sf-text mark {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
  color: var(--accent-strong);
  border-radius: 3px;
  padding: 0 1px;
}

/* ---------- 文件树筛选 ---------- */
.tree-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 6px;
  flex-shrink: 0;
}

.tf-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12px;
}

.tf-input:focus {
  outline: none;
  border-color: var(--accent);
}

.tf-clear {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 11px;
}

.tf-clear:hover {
  color: var(--danger);
  background: var(--surface-2);
}

.tf-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 12px;
}

.tf-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 8px;
  border-radius: var(--radius-s);
  text-align: left;
}

.tf-item:hover {
  background: var(--accent-soft);
}

.tf-item svg {
  flex-shrink: 0;
  color: var(--text-2);
}

.tf-name {
  flex-shrink: 0;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text);
}

.tf-dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-2);
}
</style>
