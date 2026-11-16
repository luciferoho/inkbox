<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeEmojiPicker,
  emojiPicker,
  emojiNameByChar,
  fitFontSize,
  getRecentEmojis,
  insertEmojiPick
} from '@/editor/emoji-picker'
import { EMOJI_DEFS, supportedEmojiChars } from '@/editor/cm-emoji-completion'
import { t } from '@/i18n'

/** 表情选择器：搜索 gemoji 短代码（模糊：`:eyes` 也命中 `:heart_eyes:`）+ 最近使用
    （两排）+ 网格点选，键盘 ←→↑↓/Enter/Esc。网格只保留系统字体能渲染的字符
    （canvas 缺字检测，与 `:短代码` 补全候选共用同一份）；单元格用 emoji 字体栈；
    Esc/点外关闭；锚在光标处。 */
const el = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const pos = ref({ left: 0, top: 0 })
const active = ref(-1)
const gridEl = ref<HTMLElement | null>(null)

const recents = ref<string[]>([])
const RECENTS_ROWS = 2

/** 网格词表 = 可渲染字符（首次打开时惰性求值并缓存） */
const supported = supportedEmojiChars()
const ENTRIES = Object.entries(EMOJI_DEFS).filter(([, ch]) => supported.has(String(ch)))

const nameOf = (ch: string): string => emojiNameByChar().get(ch) ?? ''

/** 所有格子统一等宽（36px），行行、列列对齐——之前按宽度占多列会让
 *  每行个数参差、dense 回填把后面的单字挪上来填洞（顺序跳动，用户实测截图）。
 *  宽组合（👨‍👩‍👧‍👦 等 ZWJ 序列）按 canvas 实测 advance 缩小后留在
 *  自己的格子里：单字形保持 20px，二字形 ≈12px，不再挤到邻格。
 *  列数打开时按网格实际内容宽（扣滚动条）算一次，「最近使用」与主网格共用，
 *  保证两个区域列对列对齐 */
const CELL_PX = 36
const GLYPH_SLOT = 32
const colCount = ref(9)
const trackStyle = computed(() => ({
  gridTemplateColumns: `repeat(${colCount.value}, ${CELL_PX}px)`
}))
const glyphStyleOf = (ch: string): { fontSize: string } => ({
  fontSize: `${fitFontSize(ch, GLYPH_SLOT, 20).toFixed(1)}px`
})

/** 最近使用显示上限 = 两排（按面板实际列数动态算，避免窄面板溢出到第三排） */
const recentLimit = ref(24)
const shownRecents = computed(() => recents.value.slice(0, recentLimit.value))

/** 搜索：去首尾冒号、按空格/下划线/- 分词，每个 token 都要命中（子串），
 *  前缀命中优先（输入 `eyes` 时 :eyes: 排在 :heart_eyes: 前面） */
const filtered = computed(() => {
  const q = emojiPicker.search.trim().toLowerCase().replace(/^:+|:+$/g, '')
  if (!q) return ENTRIES
  const tokens = q.split(/[\s_\-]+/).filter(Boolean)
  if (!tokens.length) return ENTRIES
  const scored: { e: [string, string]; rank: number }[] = []
  for (const e of ENTRIES) {
    const lower = e[0].toLowerCase()
    if (!tokens.every((tk) => lower.includes(tk))) continue
    const rank = lower.startsWith(q) ? 0 : lower.split('_')[0].startsWith(tokens[0]) ? 1 : 2
    scored.push({ e, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.e[0].length - b.e[0].length)
  return scored.map((s) => s.e)
})

watch(
  () => emojiPicker.open,
  async (open) => {
    if (!open) return
    recents.value = getRecentEmojis()
    emojiPicker.search = ''
    active.value = -1
    await nextTick()
    const box = el.value
    if (!box) return
    // 列数按主网格内容宽（满列表必有纵向滚动条，clientWidth 已扣掉）算：
    // 「最近使用」区没有滚动条，若各自 auto-fill 会差一列、两区域错位
    const inner = gridEl.value?.clientWidth ?? 308
    colCount.value = Math.max(6, Math.floor((inner + 2) / (CELL_PX + 2)))
    recentLimit.value = colCount.value * RECENTS_ROWS
    const w = box.offsetWidth
    const h = box.offsetHeight
    let left = emojiPicker.x - 20
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = emojiPicker.y + 8
    if (top + h > window.innerHeight - 8) top = Math.max(8, emojiPicker.y - h - 12)
    pos.value = { left, top: Math.max(8, Math.min(top, window.innerHeight - 8)) }
    searchEl.value?.focus()
  }
)

watch(
  () => emojiPicker.search,
  () => {
    active.value = -1
  }
)

function pick(ch: string): void {
  insertEmojiPick(ch)
}

function onGridKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeEmojiPicker()
    return
  }
  const n = filtered.value.length
  if (!n) return
  const cols = Math.max(1, colCount.value)
  let idx = active.value
  if (e.key === 'ArrowRight') idx = idx < 0 ? 0 : Math.min(n - 1, idx + 1)
  else if (e.key === 'ArrowLeft') idx = idx < 0 ? 0 : Math.max(0, idx - 1)
  else if (e.key === 'ArrowDown') idx = idx < 0 ? 0 : Math.min(n - 1, idx + cols)
  else if (e.key === 'ArrowUp') idx = idx < 0 ? 0 : Math.max(0, idx - cols)
  else if (e.key === 'Enter') {
    e.preventDefault()
    const item = active.value >= 0 ? filtered.value[active.value] : filtered.value[0]
    if (item) pick(item[1])
    return
  } else return
  e.preventDefault()
  active.value = idx
  void nextTick(() => {
    gridEl.value
      ?.querySelector(`[data-gi="${idx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function onDocMousedown(e: MouseEvent): void {
  if (!emojiPicker.open) return
  if (!(e.target instanceof Node)) return
  if (el.value?.contains(e.target)) return
  closeEmojiPicker()
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && emojiPicker.open) {
    e.stopPropagation()
    closeEmojiPicker()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onDocKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('keydown', onDocKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="emojiPicker.open"
      ref="el"
      class="emoji-picker"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @contextmenu.prevent
    >
      <input
        ref="searchEl"
        v-model="emojiPicker.search"
        class="ep-search"
        type="text"
        :placeholder="t('emoji.search')"
        spellcheck="false"
        @keydown="onGridKeydown"
      />
      <template v-if="!emojiPicker.search && recents.length">
        <div class="ep-label">{{ t('emoji.recent') }}</div>
        <div class="ep-recent" :style="trackStyle">
          <button
            v-for="(ch, i) in shownRecents"
            :key="`r${i}`"
            class="ep-cell"
            type="button"
            :title="nameOf(ch) ? `:${nameOf(ch)}:` : ch"
            :style="glyphStyleOf(ch)"
            @click="pick(ch)"
          >
            {{ ch }}
          </button>
        </div>
      </template>
      <div ref="gridEl" class="ep-grid" :style="trackStyle">
        <button
          v-for="([name, ch], i) in filtered"
          :key="name"
          class="ep-cell"
          :class="{ active: active === i }"
          :data-gi="i"
          type="button"
          :title="`:${name}:`"
          :style="glyphStyleOf(ch)"
          @click="pick(ch)"
          @pointerenter="active = i"
        >
          {{ ch }}
        </button>
        <div v-if="!filtered.length" class="ep-empty">{{ t('emoji.none') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.emoji-picker {
  position: fixed;
  z-index: 130;
  width: 340px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15, 12, 9, 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ep-search {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}

.ep-search:focus {
  border-color: var(--accent);
}

.ep-label {
  padding: 0 2px;
  color: var(--text-2);
  font-size: 11px;
}

.ep-recent {
  display: grid;
  /* 兜底 8 列：JS 打开时会按主网格实际内容宽（扣滚动条）算列数内联覆盖，
     两个区域必须同列数；左对齐而不是居中——主网格内容宽被滚动条收窄 10px，
     各自居中会让两区列位错开 5px（实测），从同一条起线排就列对列对齐 */
  grid-template-columns: repeat(8, 36px);
  justify-content: start;
  gap: 2px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.ep-grid {
  display: grid;
  grid-template-columns: repeat(8, 36px);
  justify-content: start;
  gap: 2px;
  max-height: 300px;
  overflow-y: auto;
  overflow-x: hidden;
}

.ep-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  height: 36px;
  border-radius: 6px;
  overflow: hidden;
  /* emoji 字形兜底：应用正文字体缺大量 emoji 字形（用户实测网格出方框） */
  font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Segoe UI Symbol',
    sans-serif;
  font-size: 20px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.1s;
}

.ep-cell:hover,
.ep-cell.active {
  background: var(--surface-2);
}

.ep-empty {
  grid-column: 1 / -1;
  padding: 14px 0;
  text-align: center;
  color: var(--text-2);
  font-size: 12px;
}
</style>
