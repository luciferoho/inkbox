<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeTableMenu,
  runTableMenuAction,
  tableMenu,
  tableMenuGroups,
  tableMenuTop,
  type TableMenuGroup,
  type TableMenuItem
} from '@/editor/table-context-menu'

/** 表格右键菜单（自绘，双主题）：按 行/列/整表 三模块分组子菜单
    （2026-10-31 对齐 Typora；交互样式复刻 TextContextMenu 的 hover 子菜单），
    只负责定位/关闭/渲染，条目与动作在 editor/table-context-menu.ts */
const el = ref<HTMLElement | null>(null)
const subEl = ref<HTMLElement | null>(null)
const openGroup = ref<string | null>(null)
const subItems = ref<TableMenuItem[]>([])
const subPos = ref<{ left: number; top: number }>({ left: 0, top: 0 })

const PAD = 8
let closeTimer = 0

/* 贴边收进视口：开菜单时按实际尺寸夹取（与 TabsBar 同款） */
watch(
  () => tableMenu.open,
  async (open) => {
    if (!open) return
    openGroup.value = null
    subItems.value = []
    await nextTick()
    const box = el.value
    if (!box) return
    tableMenu.x = Math.max(8, Math.min(tableMenu.x, window.innerWidth - box.offsetWidth - 8))
    tableMenu.y = Math.max(8, Math.min(tableMenu.y, window.innerHeight - box.offsetHeight - 8))
  }
)

function cancelClose(): void {
  if (closeTimer) {
    window.clearTimeout(closeTimer)
    closeTimer = 0
  }
}

/** 移出组项后留缓冲，方便指针斜向移进子菜单 */
function scheduleClose(): void {
  cancelClose()
  closeTimer = window.setTimeout(() => {
    openGroup.value = null
  }, 160)
}

async function openSubmenu(group: TableMenuGroup, evt: MouseEvent): Promise<void> {
  cancelClose()
  openGroup.value = group.id
  subItems.value = group.items
  const itemEl = evt.currentTarget as HTMLElement | null
  const r = itemEl?.getBoundingClientRect()
  const left = r ? r.right - 4 : evt.clientX
  let top = r ? r.top - 6 : evt.clientY
  subPos.value = { left, top }
  await nextTick()
  const sub = subEl.value
  if (!sub) return
  sub.style.maxHeight = ''
  let sr = sub.getBoundingClientRect()
  const availBelow = window.innerHeight - PAD - top
  if (sr.height > availBelow) {
    if (availBelow >= 160) {
      sub.style.maxHeight = `${availBelow}px`
      sr = sub.getBoundingClientRect()
    } else {
      top = Math.max(PAD, window.innerHeight - PAD - Math.min(sr.height, window.innerHeight - PAD * 2))
    }
  }
  let finalLeft = left
  if (left + sr.width > window.innerWidth - PAD) {
    finalLeft = Math.max(PAD, (r ? r.left : left) - sr.width + 6)
  }
  subPos.value = { left: finalLeft, top }
}

function closeSub(): void {
  cancelClose()
  openGroup.value = null
}

function run(action: TableMenuItem['action']): void {
  if (!action) return
  closeTableMenu()
  runTableMenuAction(action)
}

function onDocMousedown(e: MouseEvent): void {
  if (!tableMenu.open) return
  if (!(e.target instanceof Node)) return
  // 子菜单是 Teleport 到 body 的独立浮层，不在主菜单里，一并排除——
  // 否则点子项时菜单先被关闭，click 随 v-if 移除而丢失（「点了没反应」）
  if (el.value?.contains(e.target) || subEl.value?.contains(e.target)) return
  closeTableMenu()
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && tableMenu.open) closeTableMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('blur', closeTableMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('blur', closeTableMenu)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="tableMenu.open"
      ref="el"
      class="tbl-ctx-menu"
      :style="{ left: `${tableMenu.x}px`, top: `${tableMenu.y}px` }"
      @contextmenu.prevent
    >
      <!-- 剪贴板项（Typora 表格右键同样置顶） -->
      <button
        v-for="item in tableMenuTop({ readOnly: tableMenu.readOnly })"
        :key="item.action"
        class="tbl-ctx-item"
        :disabled="item.disabled"
        @mouseenter="closeSub()"
        @click="run(item.action)"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.accel" class="tbl-accel">{{ item.accel }}</span>
      </button>
      <div class="tbl-ctx-sep" />
      <div
        v-for="group in tableMenuGroups(tableMenu.targetKind)"
        :key="group.id"
        class="tbl-ctx-item has-sub"
        :class="{ active: openGroup === group.id }"
        @mouseenter="openSubmenu(group, $event)"
        @mouseleave="scheduleClose()"
      >
        <span>{{ group.label }}</span>
        <span class="tbl-arrow">›</span>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="tableMenu.open && openGroup"
      ref="subEl"
      class="tbl-ctx-menu tbl-ctx-sub"
      :style="{ left: `${subPos.left}px`, top: `${subPos.top}px` }"
      @mouseenter="cancelClose()"
      @mouseleave="scheduleClose()"
      @contextmenu.prevent
    >
      <template v-for="item in subItems" :key="item.action ?? 'sep'">
        <div v-if="item.sep" class="tbl-ctx-sep" />
        <button
          v-else
          class="tbl-ctx-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          @click="run(item.action)"
        >
          <span>{{ item.label }}</span>
          <span v-if="item.accel" class="tbl-accel">{{ item.accel }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* 材质与图片右键菜单一致（全局 .img-ctx-menu 在 ImageContextMenu.vue，此处 scoped） */
.tbl-ctx-menu {
  position: fixed;
  z-index: 120;
  min-width: 148px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 12, 9, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tbl-ctx-sub {
  z-index: 121;
  min-width: 196px;
}

.tbl-ctx-item {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}

.tbl-ctx-item:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}

.has-sub {
  cursor: default;
}

.has-sub.active {
  background: var(--surface-2);
  color: var(--text);
}

.tbl-arrow {
  margin-left: auto;
  color: var(--text-2);
  font-size: 12px;
}

.tbl-accel {
  margin-left: auto;
  padding-left: 18px;
  color: var(--text-2);
  font-size: 11px;
  letter-spacing: 0.3px;
}

.tbl-ctx-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--border);
  flex-shrink: 0;
}

.tbl-ctx-item.danger:hover:not(:disabled) {
  background: var(--danger);
  color: #fff;
}

.tbl-ctx-item:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
