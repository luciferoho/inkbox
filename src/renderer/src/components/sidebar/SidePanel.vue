<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { useWorkspaceStore } from '@/stores/workspace'
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
  const startWidth = ui.sidebarWidth
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
</script>

<template>
  <aside class="panel">
    <div
      class="resize-handle"
      title="拖动调整宽度 · 双击折叠"
      @pointerdown="onResizeStart"
      @dblclick="ui.toggleSidebar()"
    />
    <div class="panel-head">
      <div class="segmented">
        <button :class="{ on: ui.sidebarMode === 'outline' }" @click="ui.setSidebarMode('outline')">
          大纲
        </button>
        <button :class="{ on: ui.sidebarMode === 'files' }" @click="ui.setSidebarMode('files')">
          文件
        </button>
      </div>
      <button class="collapse-btn" title="折叠侧栏 (Ctrl+\)" @click="ui.toggleSidebar()">
        <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M6.5 1.5L3 5l3.5 3.5" />
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <!-- 大纲 -->
      <template v-if="ui.sidebarMode === 'outline'">
        <div v-if="!docs.active" class="empty">
          <p>打开文档后，这里会显示标题结构树。</p>
        </div>
        <div v-else-if="outline.length === 0" class="empty">
          <p>文档中还没有标题。</p>
          <p class="hint-tip">用 <kbd>#</kbd> 到 <kbd>######</kbd> 创建标题，或 <kbd>Ctrl</kbd>+<kbd>=</kbd> 提升标题级别。</p>
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
      <template v-else>
        <div v-if="!ws.root" class="empty">
          <p>将文件夹设为工作区，在此浏览与管理笔记。</p>
          <button class="btn-ghost" @click="openFolder">打开文件夹</button>
        </div>
        <template v-else>
          <div class="ws-root" :title="ws.root">
            <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
              <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
            </svg>
            <span class="ws-name">{{ ws.root.split(/[\\/]/).pop() }}</span>
            <span class="ws-acts" @click.stop>
              <button class="ws-act" title="新建文档" @click="ws.beginCreate(ws.root, false)">＋</button>
              <button class="ws-act" title="新建文件夹" @click="ws.beginCreate(ws.root, true)">⊞</button>
            </span>
          </div>
          <div v-if="ws.draft && ws.draft.mode !== 'rename' && ws.draft.parentPath === ws.root" class="draft-row">
            <input
              :placeholder="ws.draft.mode === 'new-dir' ? '文件夹名' : '文档名.md'"
              :value="ws.draft.value"
              autofocus
              @input="ws.draft && (ws.draft.value = ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="ws.commitDraft()"
              @keydown.esc="ws.cancelDraft()"
              @blur="ws.commitDraft()"
            />
          </div>
          <FileTreeNode
            v-for="entry in ws.children[ws.root]"
            :key="entry.path"
            :entry="entry"
            :depth="1"
          />
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

.ws-acts {
  display: none;
  align-items: center;
  gap: 2px;
}

.ws-root:hover .ws-acts {
  display: inline-flex;
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
</style>
