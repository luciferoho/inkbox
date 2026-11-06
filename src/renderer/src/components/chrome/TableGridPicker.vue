<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { closeTableGrid, pickTableGrid, tableGrid } from '@/editor/table-grid'


/** 表格行列选择器（5.6）：5×5 网格 hover 出子矩形，点格插入。
    打开不抢焦点（容器 mousedown.prevent 保住编辑器选区），Esc/点外/失焦取消；
    下方空间不足时锚点上翻到光标上方。 */
const el = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0 })

const SIZE = 5
const CELL = 24
const HEAD_H = 24
const PAD = 8

watch(
  () => tableGrid.open,
  async (open) => {
    if (!open) return
    await nextTick()
    const box = el.value
    if (!box) return
    const w = box.offsetWidth
    const h = box.offsetHeight
    let left = tableGrid.ax - 14 // 与光标竖线大致对齐
    left = Math.max(PAD, Math.min(left, window.innerWidth - w - PAD))
    let top = tableGrid.ay + 6
    if (top + h > window.innerHeight - PAD) top = Math.max(PAD, tableGrid.ay - h - 10)
    pos.value = { left, top: Math.min(top, window.innerHeight - h - PAD) }
  }
)

function hover(r: number, c: number): void {
  tableGrid.rows = r
  tableGrid.cols = c
}

function clearHover(): void {
  tableGrid.rows = 0
  tableGrid.cols = 0
}

function inRect(r: number, c: number): boolean {
  return tableGrid.rows > 0 && r <= tableGrid.rows && c <= tableGrid.cols
}

function onDocMousedown(e: MouseEvent): void {
  if (!tableGrid.open) return
  const target = e.target as HTMLElement | null
  if (target?.closest?.('.tbl-grid')) return
  closeTableGrid()
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && tableGrid.open) closeTableGrid()
}

function onBlur(): void {
  closeTableGrid()
}

function pick(r: number, c: number): void {
  void pickTableGrid(r, c)
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('blur', onBlur)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('blur', onBlur)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tableGrid.open"
      ref="el"
      class="tbl-grid"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      @mousedown.prevent
      @contextmenu.prevent
      @mouseleave="clearHover"
    >
      <div class="grid-head">
        <template v-if="tableGrid.rows > 0">{{ tableGrid.rows }} 行 × {{ tableGrid.cols }} 列</template>
        <template v-else>{{ $t('table.gridTip') }}</template>
      </div>
      <div class="grid-body">
        <div v-for="r in SIZE" :key="`r${r}`" class="grid-row">
          <span
            v-for="c in SIZE"
            :key="`c${c}`"
            class="grid-cell"
            :class="{ hit: inRect(r, c) }"
            @mouseenter="hover(r, c)"
            @click="pick(r, c)"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tbl-grid {
  position: fixed;
  z-index: 132;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 12, 9, 0.28);
  user-select: none;
}

.grid-head {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}

.grid-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.grid-row {
  display: flex;
  gap: 3px;
}

.grid-cell {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  cursor: pointer;
}

.grid-cell.hit {
  background: var(--accent-soft);
  border-color: var(--accent-strong);
}
</style>
