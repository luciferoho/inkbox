<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { DirEntry } from '@shared/types'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDocumentsStore } from '@/stores/documents'

const props = defineProps<{ entry: DirEntry; depth: number }>()

const ws = useWorkspaceStore()
const docs = useDocumentsStore()

const MD_EXT = ['.md', '.markdown', '.mdown', '.txt']

function isMarkdown(name: string): boolean {
  const i = name.lastIndexOf('.')
  return i >= 0 && MD_EXT.includes(name.slice(i).toLowerCase())
}

async function click(): Promise<void> {
  if (props.entry.isDir) await ws.toggle(props.entry.path)
  else if (isMarkdown(props.entry.name)) await docs.openPath(props.entry.path)
}

/* 内联输入（新建/重命名）自动聚焦与全选文件名主干 */
const draftInput = ref<HTMLInputElement | null>(null)
watch(
  () => ws.draft,
  async (d) => {
    if (!d) return
    await nextTick()
    const el = draftInput.value
    if (!el) return
    el.focus()
    const dot = d.mode === 'new-file' ? d.value.lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : d.value.length)
  },
  { flush: 'post' }
)
</script>

<template>
  <div>
    <button
      class="node"
      :class="{ dir: entry.isDir, md: !entry.isDir && isMarkdown(entry.name), open: ws.expanded[entry.path] }"
      :style="{ paddingLeft: `${8 + (depth - 1) * 14}px` }"
      :title="entry.name"
      @click="click"
    >
      <template v-if="entry.isDir">
        <svg class="chev" viewBox="0 0 10 10" width="8" height="8">
          <path d="M2.5 1.5L7.5 5l-5 3.5z" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
          <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
        </svg>
      </template>
      <svg v-else viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <path d="M5 2.5h6l4 4v11H5z" />
        <path d="M11 2.5v4h4" />
      </svg>
      <span class="name">{{ entry.name }}</span>

      <!-- 悬浮操作 -->
      <span v-if="entry.isDir" class="acts" @click.stop>
        <button class="act" title="新建文档" @click.stop="ws.beginCreate(entry.path, false)">＋</button>
        <button class="act" title="新建文件夹" @click.stop="ws.beginCreate(entry.path, true)">⊞</button>
      </span>
      <span class="acts" @click.stop>
        <button class="act" title="重命名" @click.stop="ws.beginRename(entry.path, entry.name)">✎</button>
        <button class="act del" title="删除" @click.stop="ws.deleteEntry(entry)">✕</button>
      </span>
    </button>

    <!-- 重命名草稿行（文件与目录通用） -->
    <div v-if="ws.draft?.mode === 'rename' && ws.draft.targetPath === entry.path" class="draft-row" :style="{ paddingLeft: `${22 + (depth - 1) * 14}px` }">
      <input
        ref="draftInput"
        v-model="ws.draft.value"
        @keydown.enter.prevent="ws.commitDraft()"
        @keydown.esc="ws.cancelDraft()"
        @blur="ws.commitDraft()"
      />
    </div>

    <!-- 新建草稿输入行（父目录展开时） -->
    <div v-if="ws.draft && ws.draft.mode !== 'rename' && entry.isDir && ws.expanded[entry.path] && ws.draft.parentPath === entry.path" class="draft-row" :style="{ paddingLeft: `${22 + (depth - 1) * 14}px` }">
      <input
        ref="draftInput"
        v-model="ws.draft.value"
        :placeholder="ws.draft.mode === 'new-dir' ? '文件夹名' : '文档名.md'"
        @keydown.enter.prevent="ws.commitDraft()"
        @keydown.esc="ws.cancelDraft()"
        @blur="ws.commitDraft()"
      />
    </div>

    <template v-if="entry.isDir && ws.expanded[entry.path] && !(ws.draft?.mode === 'rename' && ws.draft.targetPath === entry.path)">
      <FileTreeNode
        v-for="child in ws.children[entry.path]"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>

<style scoped>
.node {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 27px;
  padding-right: 8px;
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 12.5px;
  text-align: left;
}

.node:hover {
  background: var(--surface-2);
  color: var(--text);
}

.node.md {
  color: var(--text);
}

.chev {
  transition: transform 0.12s;
}

.node.open .chev {
  transform: rotate(90deg);
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 悬浮操作按钮 */
.acts {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.node:hover .acts {
  display: inline-flex;
}

.act {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  color: var(--text-2);
  font-size: 11px;
  line-height: 1;
}

.act:hover {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.act.del:hover {
  color: #fff;
  background: var(--danger);
}

/* 内联输入 */
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
