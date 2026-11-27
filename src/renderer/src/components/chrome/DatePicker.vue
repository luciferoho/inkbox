<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeDatePicker,
  datePicker,
  datePickerOwns,
  insertDatePick,
  monthGrid,
  moveCursor,
  moveCursorMonths,
  sameDay,
  toLocal,
  weekStart,
  type LocalDate
} from '@/editor/date-picker'
import { currentLocale, t } from '@/i18n'

/** 日期选择器：月历点选 → 插入 YYYY-MM-DD（数据层在 editor/date-picker.ts）。
    打开不抢焦点（容器 mousedown.prevent）：选区、滚动、输入法状态都留在编辑器里，
    导航键由 document 捕获阶段接管；点日格 / Enter / 「今天」即插入，
    Esc / 点外 / 窗口失焦 / 继续输入 / 滚动收起；下方空间不足上翻到光标上方。 */
const el = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0 })
/** 今天：每次打开时取一次，避免浮层开着跨午夜时「今天」格与按钮各说各话 */
const today = ref<LocalDate>({ y: 0, m: 0, d: 1 })

const PAD = 8

/** 标题 / 星期表头 / 底栏预览交给 Intl 按应用语言出（中文「2026年11月」「一…日」） */
function fmt(opts: Intl.DateTimeFormatOptions, date: Date): string {
  return new Intl.DateTimeFormat(currentLocale(), opts).format(date)
}

const title = computed(() =>
  fmt({ year: 'numeric', month: 'long' }, new Date(datePicker.year, datePicker.month, 1))
)

/** 星期表头按周首日排（2024-01-07 是周日，从它起数一周） */
const weekdays = computed(() => {
  const start = weekStart()
  return Array.from({ length: 7 }, (_, i) =>
    fmt({ weekday: 'narrow' }, new Date(2024, 0, 7 + start + i))
  )
})

const cells = computed(() => monthGrid(datePicker.year, datePicker.month, weekStart()))

const preview = computed(() => {
  const c = datePicker.cursor
  return fmt(
    { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' },
    new Date(c.y, c.m, c.d)
  )
})

watch(
  () => datePicker.open,
  async (open) => {
    if (!open) return
    today.value = toLocal(new Date())
    await nextTick()
    const box = el.value
    if (!box) return
    const w = box.offsetWidth
    const h = box.offsetHeight
    let left = datePicker.x - 14 // 与光标竖线大致对齐
    left = Math.max(PAD, Math.min(left, window.innerWidth - w - PAD))
    // 下方放得下贴着光标行下沿，否则贴着上沿上翻（两头对称留 6px，不盖住光标行）
    let top = datePicker.bottom + 6
    if (top + h > window.innerHeight - PAD) top = datePicker.top - h - 6
    // 上方也放不下（窗口比浮层矮不了多少）就钉在顶部：标题栏的翻页键比底栏更要紧
    pos.value = { left, top: Math.max(PAD, Math.min(top, window.innerHeight - h - PAD)) }
  }
)

function hover(day: LocalDate): void {
  datePicker.cursor = day
}

function pick(day: LocalDate): void {
  insertDatePick(day)
}

/* ---------- 键盘：编辑器持有焦点，导航键在捕获阶段接管，不落到编辑器里移光标 ---------- */

const NAV = new Map<string, () => void>([
  ['ArrowLeft', () => moveCursor(-1)],
  ['ArrowRight', () => moveCursor(1)],
  ['ArrowUp', () => moveCursor(-7)],
  ['ArrowDown', () => moveCursor(7)],
  ['PageUp', () => moveCursorMonths(-1)],
  ['PageDown', () => moveCursorMonths(1)],
  ['Enter', () => insertDatePick(datePicker.cursor)]
])
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'])

function onDocKeydown(e: KeyboardEvent): void {
  if (!datePicker.open) return
  const esc = e.key === 'Escape'
  // 带修饰键的组合（Ctrl+Z、各快捷键）不接管
  const nav = e.ctrlKey || e.metaKey || e.altKey ? undefined : NAV.get(e.key)
  // 焦点已不在这台编辑器里（插入面板/快速打开等别的输入框抢走了）时不能截键，
  // 否则人家的 Enter/方向键会被这里吞掉
  if (e.target instanceof Node && datePickerOwns(e.target) && (esc || nav)) {
    e.stopPropagation()
    if (esc) closeDatePicker()
    else {
      e.preventDefault()
      nav?.()
    }
    return
  }
  // 其余按键照常放行；用户已转去干别的（继续打字、Tab、Ctrl+Z…）或焦点被抢就收起让路，单独按修饰键不算
  if (!MODIFIERS.has(e.key)) closeDatePicker()
}

function onDocMousedown(e: MouseEvent): void {
  if (!datePicker.open) return
  const target = e.target as HTMLElement | null
  if (target?.closest?.('.date-picker')) return
  closeDatePicker()
}

function closeIfOpen(): void {
  if (datePicker.open) closeDatePicker()
}

/** scroll：浮层锚在光标的屏幕坐标上、不跟随滚动，编辑器一滚就对不上号；blur：窗口失焦即用户离开了 */
onMounted(() => {
  document.addEventListener('keydown', onDocKeydown, true)
  document.addEventListener('mousedown', onDocMousedown, true)
  window.addEventListener('scroll', closeIfOpen, true)
  window.addEventListener('blur', closeIfOpen)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown, true)
  document.removeEventListener('mousedown', onDocMousedown, true)
  window.removeEventListener('scroll', closeIfOpen, true)
  window.removeEventListener('blur', closeIfOpen)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="datePicker.open"
      ref="el"
      class="date-picker"
      role="dialog"
      :aria-label="t('dp.title')"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @mousedown.prevent
      @contextmenu.prevent
    >
      <div class="dp-head">
        <button type="button" class="dp-nav" :title="t('dp.prevYear')" @click="moveCursorMonths(-12)">«</button>
        <button type="button" class="dp-nav" :title="t('dp.prevMonth')" @click="moveCursorMonths(-1)">‹</button>
        <span class="dp-title">{{ title }}</span>
        <button type="button" class="dp-nav" :title="t('dp.nextMonth')" @click="moveCursorMonths(1)">›</button>
        <button type="button" class="dp-nav" :title="t('dp.nextYear')" @click="moveCursorMonths(12)">»</button>
      </div>
      <div class="dp-grid">
        <span v-for="(w, i) in weekdays" :key="`w${i}`" class="dp-wd">{{ w }}</span>
        <button
          v-for="c in cells"
          :key="c.iso"
          type="button"
          class="dp-day"
          :class="{
            out: !c.inMonth,
            today: sameDay(c.day, today),
            cursor: sameDay(c.day, datePicker.cursor)
          }"
          :title="c.iso"
          @pointerenter="hover(c.day)"
          @click="pick(c.day)"
        >
          {{ c.day.d }}
        </button>
      </div>
      <div class="dp-foot">
        <span class="dp-preview">{{ preview }}</span>
        <button type="button" class="dp-today" @click="pick(today)">{{ t('dp.today') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.date-picker {
  position: fixed;
  z-index: 131;
  padding: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  gap: 6px;
  user-select: none;
}

.dp-head {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
}

.dp-nav {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 15px;
  line-height: 1;
}

.dp-nav:hover {
  background: var(--surface-2);
  color: var(--text);
}

.dp-title {
  flex: 1;
  text-align: center;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 34px);
  gap: 2px;
}

.dp-wd {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
  font-size: 11px;
}

.dp-day {
  height: 30px;
  border-radius: var(--radius-s);
  color: var(--text);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.dp-day.out {
  color: var(--text-2);
  opacity: 0.55;
}

.dp-day.today {
  color: var(--accent-strong);
  font-weight: 700;
}

.dp-day.cursor,
.dp-day:hover {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.dp-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.dp-preview {
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}

.dp-today {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--radius-s);
  color: var(--accent-strong);
  font-size: 12px;
  white-space: nowrap;
}

.dp-today:hover {
  background: var(--accent-soft);
}
</style>
