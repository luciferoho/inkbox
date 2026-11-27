<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { closeFormatBar, formatBar, runFormatBarAction } from '@/editor/format-bar'
import { useUiStore } from '@/stores/ui'

/** 选区浮动格式条（5.5）：即显选中文本浮现（editor/format-bar.ts 触发与动作）。
    容器 mousedown preventDefault——保住 PM 选区不被点击塌陷；条外 mousedown
    由 format-bar.ts 收条。标题切换是条内小浮层，空间不足向上翻。 */

const ui = useUiStore()
const el = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0 })
const headingOpen = ref(false)
const menuPos = ref({ left: 0, top: 0 })

const BAR_H = 36
const GAP = 8
const PAD = 8

const HEADINGS = [1, 2, 3, 4, 5, 6]

watch(
  () => formatBar.open,
  async (open) => {
    headingOpen.value = false
    if (!open) return
    await nextTick()
    const box = el.value
    if (!box) return
    const w = box.offsetWidth
    let left = formatBar.ax - w / 2
    left = Math.max(PAD, Math.min(left, window.innerWidth - w - PAD))
    // 优先悬在选区上方；顶部空间不足落选区下方
    let top = formatBar.ayTop - BAR_H - GAP
    if (top < PAD) top = formatBar.ayBottom + GAP
    top = Math.max(PAD, Math.min(top, window.innerHeight - BAR_H - PAD))
    pos.value = { left, top }
  }
)

watch(
  () => ui.editorPrefs.formatBar,
  (on) => {
    if (on === false) closeFormatBar()
  }
)

function openHeadingMenu(evt: MouseEvent): void {
  if (headingOpen.value) {
    headingOpen.value = false
    return
  }
  const btn = evt.currentTarget as HTMLElement | null
  const r = btn?.getBoundingClientRect()
  const left = r ? r.left : pos.value.left
  let top = r ? r.bottom + 4 : pos.value.top + BAR_H
  // 下方空间不够（条本身已在选区下方时常见）→ 向上弹
  const need = 7 * 30 + 12
  if (top + need > window.innerHeight - PAD) top = (r ? r.top : pos.value.top) - 4 - need
  menuPos.value = { left, top: Math.max(PAD, top) }
  headingOpen.value = true
}

async function pickHeading(id: string): Promise<void> {
  headingOpen.value = false
  runFormatBarAction(id)
}

function toggleMark(id: string): void {
  headingOpen.value = false
  runFormatBarAction(id)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="formatBar.open"
      ref="el"
      class="fmt-bar"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @mousedown.prevent
      @contextmenu.prevent
    >
      <!-- 图标统一：全条一套线稿（同 24 网格、同线宽、同 14px 视觉体量），与表格工具条/代码块工具栏同语言 -->
      <button
        class="fmt-btn"
        :class="{ on: formatBar.marks.strong }"
        :title="$t('sc.bold')"
        @click="toggleMark('strong')"
      >
        <svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
          <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
        </svg>
      </button>
      <button
        class="fmt-btn"
        :class="{ on: formatBar.marks.em }"
        :title="$t('sc.italic')"
        @click="toggleMark('emphasis')"
      >
        <svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 4h-9" />
          <path d="M14 20H5" />
          <path d="m15 4-6 16" />
        </svg>
      </button>
      <button
        class="fmt-btn"
        :class="{ on: formatBar.marks.strike }"
        :title="$t('sc.strike')"
        @click="toggleMark('strike_through')"
      >
        <svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 4H9a3 3 0 0 0-2.83 4" />
          <path d="M14 12a4 4 0 0 1 0 8H6" />
          <path d="M4 12h16" />
        </svg>
      </button>
      <button
        class="fmt-btn"
        :class="{ on: formatBar.marks.code }"
        :title="$t('sc.inlineCode')"
        @click="toggleMark('inlineCode')"
      >
        <svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="m18 16 4-4-4-4" />
          <path d="m6 8-4 4 4 4" />
          <path d="m14.5 4-5 16" />
        </svg>
      </button>
      <button
        class="fmt-btn"
        :class="{ on: formatBar.marks.mark }"
        :title="$t('block.highlight')"
        @click="toggleMark('mark')"
      >
        <svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11.5 10.5 18.6 3.45a2.8 2.8 0 0 1 3.95 3.96L15.5 14.5z" />
          <path d="M11.5 10.5 2 20h8l5.5-5.5" />
        </svg>
      </button>
      <button
        class="fmt-btn"
        :title="$t('sc.link')"
        @click="toggleMark('link')"
      >
        <svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>
      <span v-if="formatBar.canHeading" class="fmt-sep" />
      <button
        v-if="formatBar.canHeading"
        class="fmt-btn heading"
        :title="$t('ctx.paraConvert')"
        @click="openHeadingMenu"
      >
        <svg class="glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 4v16" />
          <path d="M18 4v16" />
          <path d="M6 12h12" />
        </svg>
        <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="formatBar.open && headingOpen"
        ref="menuEl"
        class="fmt-bar-menu"
        :style="{ left: `${menuPos.left}px`, top: `${menuPos.top}px` }"
        @mousedown.prevent
        @contextmenu.prevent
      >
        <button
          class="ctx-item"
          @click="pickHeading('body')"
        >
          <span>{{ $t('ctx.paraBody') }}</span>
          <span class="ctx-accel">Ctrl+0</span>
        </button>
        <button
          v-for="lv in HEADINGS"
          :key="lv"
          class="ctx-item"
          :class="{ active: formatBar.heading === lv }"
          @click="pickHeading(`h${lv}`)"
        >
          <span>{{ `H${lv}` }}</span>
          <span class="ctx-accel">Ctrl+{{ lv }}</span>
        </button>
      </div>
    </Teleport>
  </Teleport>
</template>

<style scoped>
.fmt-bar {
  position: fixed;
  z-index: 132;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 36px;
  padding: 0 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 6px 20px rgba(15, 12, 9, 0.24);
  user-select: none;
}

.fmt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 28px;
  height: 28px;
  padding: 0 5px;
  border-radius: 6px;
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

.fmt-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.fmt-btn.on {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

/* 全条一套线稿图标：同 24 网格、同 2.25 线宽（渲染 ≈1.3px）、同 14px 视觉体量。
   以前是字形（衬线 B/I/S/H）+ 等宽 </> + 线稿混搭，风格和大小都对不齐 */
.glyph-icon {
  display: block;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.fmt-btn.heading {
  min-width: 38px;
}

.caret {
  width: 10px;
  height: 10px;
  opacity: 0.7;
  flex-shrink: 0;
}

.fmt-sep {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--border);
}

.fmt-bar-menu {
  position: fixed;
  z-index: 133;
  min-width: 150px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 12, 9, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 条目复用全局 ctx-item 观感（与右键菜单同体系），只补布局 */
.fmt-bar-menu .ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  color: var(--text-2);
  font-size: 13px;
  white-space: nowrap;
  width: 100%;
}

.fmt-bar-menu .ctx-item:hover,
.fmt-bar-menu .ctx-item.active {
  background: var(--surface-2);
  color: var(--text);
}

.fmt-bar-menu .ctx-accel {
  color: var(--text-2);
  font-size: 11.5px;
}
</style>
