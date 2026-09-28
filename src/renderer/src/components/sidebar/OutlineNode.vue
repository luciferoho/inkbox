<script setup lang="ts">
import type { OutlineItem } from '@/services/markdown'

export interface OutlineTreeNode extends OutlineItem {
  children: OutlineTreeNode[]
}

const props = defineProps<{
  node: OutlineTreeNode
  depth: number
  /** 折叠状态集合（按标题行号），不在集合中 = 展开 */
  collapsed: Set<number>
  activeLine: number
}>()

const emit = defineEmits<{
  (e: 'toggle', line: number): void
  (e: 'select', line: number): void
}>()
</script>

<template>
  <div>
    <button
      class="node"
      :class="{ on: activeLine === node.line }"
      :style="{ paddingLeft: `${8 + (depth - 1) * 14}px` }"
      :title="node.text"
      @click="emit('select', node.line)"
    >
      <svg
        v-if="node.children.length"
        class="chev"
        :class="{ closed: collapsed.has(node.line) }"
        viewBox="0 0 10 10"
        width="8"
        height="8"
        @click.stop="emit('toggle', node.line)"
      >
        <path d="M2.5 1.5L7.5 5l-5 3.5z" fill="currentColor" />
      </svg>
      <i v-else class="tick" />
      <span class="name">{{ node.text || '（无标题文字）' }}</span>
    </button>

    <template v-if="node.children.length && !collapsed.has(node.line)">
      <OutlineNode
        v-for="child in node.children"
        :key="child.line"
        :node="child"
        :depth="depth + 1"
        :collapsed="collapsed"
        :active-line="activeLine"
        @toggle="(l) => emit('toggle', l)"
        @select="(l) => emit('select', l)"
      />
    </template>
  </div>
</template>

<style scoped>
.node {
  display: flex;
  align-items: center;
  gap: 8px;
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

.node.on {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.chev {
  flex-shrink: 0;
  color: var(--text-2);
  padding: 3px;
  margin: -3px 0;
  border-radius: 3px;
  transition: transform 0.12s;
  cursor: pointer;
}

.chev:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.chev.closed {
  transform: rotate(-90deg);
}

.tick {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-2);
  opacity: 0.6;
  flex-shrink: 0;
  margin: 0 5px;
}

.node.on .tick {
  background: var(--accent);
  opacity: 1;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
