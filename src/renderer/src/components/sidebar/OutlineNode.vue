<script setup lang="ts">
import { computed } from 'vue'
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

/** 大纲标题行内样式分段（Typora 效果）：行内代码/粗/斜/粗斜/删除/高亮/链接/
 *  图片 alt 按各自样式渲染，其余原样。正则按优先级一次扫描；
 *  `__`/`_` 加词边界（lookbehind/lookahead）：snake_case 不误判为斜体，
 *  `*`/`**` 不加（CommonMark 允许词内强调） */
interface Seg {
  t: 'text' | 'code' | 'bold' | 'boldem' | 'em' | 'del' | 'mark' | 'link' | 'img'
  s: string
}

const INLINE_RE =
  /(`+)([\s\S]*?)\1|\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|(?<![\p{L}\p{N}_])__([^_\n]+)__(?![\p{L}\p{N}_])|\*([^*\n]+)\*|(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])|~~([^~\n]+)~~|==([^=\n]+)==|!\[([^\]]*)\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)/gu

function tokenize(src: string): Seg[] {
  const segs: Seg[] = []
  let last = 0
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(src))) {
    if (m.index > last) segs.push({ t: 'text', s: src.slice(last, m.index) })
    if (m[1] !== undefined) segs.push({ t: 'code', s: m[2] })
    else if (m[3] !== undefined) segs.push({ t: 'boldem', s: m[3] })
    else if (m[4] !== undefined) segs.push({ t: 'bold', s: m[4] })
    else if (m[5] !== undefined) segs.push({ t: 'bold', s: m[5] })
    else if (m[6] !== undefined) segs.push({ t: 'em', s: m[6] })
    else if (m[7] !== undefined) segs.push({ t: 'em', s: m[7] })
    else if (m[8] !== undefined) segs.push({ t: 'del', s: m[8] })
    else if (m[9] !== undefined) segs.push({ t: 'mark', s: m[9] })
    else if (m[10] !== undefined) segs.push({ t: 'img', s: m[10] || '(图)' })
    else if (m[11] !== undefined) segs.push({ t: 'link', s: m[11] })
    last = INLINE_RE.lastIndex
  }
  if (last < src.length) segs.push({ t: 'text', s: src.slice(last) })
  return segs
}

const segs = computed<Seg[]>(() => tokenize(props.node.text))
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
      <span class="name"
        ><span v-for="(sg, i) in segs" :key="i" :class="`ol-${sg.t}`">{{ sg.s }}</span>
        <span v-if="!segs.length" class="ol-text">{{ $t('outline.untitled') }}</span></span
      >
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

/* 命中态（.node.on）下粗体类样式不抢强调色 */
.node.on .ol-bold,
.node.on .ol-boldem {
  color: inherit;
}

/* 大纲标题行内样式（Typora 效果）：随主题变量走 */
.ol-code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 1px 4px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px var(--code-edge);
}

.ol-bold {
  font-weight: 700;
  color: var(--text);
}

.ol-boldem {
  font-weight: 700;
  font-style: italic;
  color: var(--text);
}

.ol-em {
  font-style: italic;
}

.ol-del {
  text-decoration: line-through;
  opacity: 0.7;
}

.ol-mark {
  background: color-mix(in srgb, var(--accent) 26%, transparent);
  color: var(--accent-strong);
  padding: 0 3px;
  border-radius: 3px;
}

.ol-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ol-img {
  opacity: 0.65;
  font-style: italic;
}
</style>
