<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useDocumentsStore } from '@/stores/documents'

const docs = useDocumentsStore()

/* ---------- 拖拽排序（鼠标与标签中点比较决定插前/插后，支持拖到最后；主页不可越过） ---------- */
const dragId = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function onDragStart(id: number, e: DragEvent): void {
  if (docs.tabs.find((t) => t.id === id)?.isHome) return
  dragId.value = id
  e.dataTransfer?.setData('text/plain', String(id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(index: number, e: DragEvent): void {
  if (dragId.value === null) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const before = e.clientX < rect.left + rect.width / 2 ? index : index + 1
  dropIndex.value = Math.max(1, before) // 主页常驻首位
}

function onDrop(e: DragEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (dragId.value !== null && dropIndex.value !== null) {
    docs.moveTab(dragId.value, dropIndex.value)
  }
  dragId.value = null
  dropIndex.value = null
}

/* 容器尾部区域（＋按钮附近）也允许放置 = 拖到最后一格 */
function onTrailingDragOver(e: DragEvent): void {
  if (dragId.value === null) return
  const tabs = (e.currentTarget as HTMLElement).querySelectorAll('.tab:not(.home)')
  const last = tabs[tabs.length - 1] as HTMLElement | undefined
  if (last && e.clientX < last.getBoundingClientRect().right - 2) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropIndex.value = docs.tabs.length
}

function onTrailingDrop(e: DragEvent): void {
  if (dropIndex.value !== docs.tabs.length) return
  e.preventDefault()
  if (dragId.value !== null) docs.moveTab(dragId.value, docs.tabs.length)
  dragId.value = null
  dropIndex.value = null
}

function onDragEnd(): void {
  dragId.value = null
  dropIndex.value = null
}

/* ---------- 横向滚动：滚轮换向 + 激活标签滚入视野 ---------- */
const tabsScroll = ref<HTMLElement | null>(null)

function onWheel(e: WheelEvent): void {
  const el = tabsScroll.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  e.preventDefault()
  el.scrollLeft += e.deltaY
}

watch(
  () => docs.activeId,
  async () => {
    await nextTick()
    const c = tabsScroll.value
    const el = c?.querySelector('.tab.active') as HTMLElement | null
    if (!c || !el) return
    const l = el.offsetLeft
    const r = l + el.offsetWidth
    if (l < c.scrollLeft) c.scrollLeft = l - 8
    else if (r > c.scrollLeft + c.clientWidth) c.scrollLeft = r - c.clientWidth + 8
  }
)

/* ---------- 右键菜单 ---------- */
const menu = reactive({ open: false, x: 0, y: 0, id: 0 })

function openMenu(id: number, e: MouseEvent): void {
  if (docs.tabs.find((t) => t.id === id)?.isHome) return // 主页无右键菜单
  menu.open = true
  menu.x = e.clientX
  menu.y = e.clientY
  menu.id = id
}

function closeMenu(): void {
  menu.open = false
}

function onMousedown(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (menu.open && !el.closest('.tab-menu')) closeMenu()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMenu()
}

onMounted(() => {
  window.addEventListener('mousedown', onMousedown)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onMousedown)
  window.removeEventListener('keydown', onKeydown)
})

function run(action: () => void): void {
  action()
  closeMenu()
}

type MenuItem = { label: string; danger?: boolean; act: () => void; disabled?: boolean }

function menuItems(id: number): MenuItem[] {
  const idx = docs.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return []
  const realCount = docs.tabs.length - 1 // 除去主页
  return [
    { label: '关闭标签页', act: () => void docs.closeIfClean(docs.tabs[idx]) },
    { label: `关闭左侧（${idx - 1}）`, act: () => void docs.closeToLeft(id), disabled: idx <= 1 },
    {
      label: `关闭右侧（${docs.tabs.length - idx - 1}）`,
      act: () => void docs.closeToRight(id),
      disabled: idx === docs.tabs.length - 1
    },
    { label: '关闭其他', act: () => void docs.closeOthers(id), disabled: realCount <= 1 },
    { label: '关闭全部', act: () => void docs.closeAllTabs(), danger: true }
  ]
}
</script>

<template>
  <div class="tabsbar">
    <div
      ref="tabsScroll"
      class="tabs"
      @wheel.prevent="onWheel"
      @dragover="onTrailingDragOver"
      @drop="onTrailingDrop"
    >
      <!-- 主页标签：固定首位，纯图标，不可关闭/拖拽 -->
      <button
        class="tab home"
        :class="{ active: docs.activeId === 0 }"
        title="主页"
        @click="docs.activateHome()"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">
          <path d="M3.5 9.5L10 4l6.5 5.5" />
          <path d="M5.5 9v6.5h9V9" />
          <path d="M8.5 15.5v-4h3v4" />
        </svg>
      </button>

      <button
        v-for="(tab, index) in docs.tabs.filter((t) => !t.isHome)"
        :key="tab.id"
        class="tab"
        :class="{
          active: tab.id === docs.activeId,
          dragging: dragId === tab.id,
          'drop-before': dropIndex === index + 1 && dragId !== tab.id,
          'drop-after': dropIndex === index + 2 && index === docs.tabs.length - 2 && dragId !== tab.id
        }"
        :title="tab.path ?? tab.name"
        draggable="true"
        @click="docs.activate(tab.id)"
        @dragstart="onDragStart(tab.id, $event)"
        @dragover="onDragOver(index + 1, $event)"
        @drop="onDrop($event)"
        @dragend="onDragEnd"
        @contextmenu.prevent="openMenu(tab.id, $event)"
      >
        <span class="tab-label">{{ tab.name }}</span>
        <span v-if="tab.dirty" class="dot" title="未保存" />
        <svg
          v-if="tab.id === docs.activeId && !tab.dirty"
          class="tab-close"
          viewBox="0 0 10 10"
          width="9"
          height="9"
          title="关闭标签页"
          @click.stop="docs.closeTab(tab.id)"
        >
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <!-- 新建按钮跟在最后一个标签之后（随标签滚动） -->
      <button class="new-tab" title="新建文档 (Ctrl+N)" @click="docs.newDoc()">＋</button>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="menu.open"
        class="tab-menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @contextmenu.prevent
      >
        <button
          v-for="(item, i) in menuItems(menu.id)"
          :key="i"
          class="tab-menu-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          @click="run(item.act)"
        >
          {{ item.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tabsbar {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 0 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.tabs::-webkit-scrollbar {
  height: 3px;
}

.tabs::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.tabs::-webkit-scrollbar-track {
  background: transparent;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-m) var(--radius-m) 0 0;
  color: var(--text-2);
  font-size: 12.5px;
  max-width: 190px;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.tab:hover {
  color: var(--text);
  background: var(--surface-2);
}

.tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 -1px 2px rgba(38, 32, 25, 0.05);
}

/* 主页标签：纯图标，紧凑 */
.tab.home {
  padding: 0 10px;
  color: var(--text-2);
}

.tab.home:hover {
  color: var(--accent-strong);
}

.tab.home.active {
  color: var(--accent-strong);
}

.tab.dragging {
  opacity: 0.45;
}

/* 拖放插入指示：前插 = 左缘线；拖到最后 = 末标签右缘线 */
.tab.drop-before {
  box-shadow: inset 2px 0 0 var(--accent);
}

.tab.drop-after {
  box-shadow: inset -2px 0 0 var(--accent);
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  color: var(--text-2);
  border-radius: 3px;
  padding: 2px;
  cursor: pointer;
}

.tab-close:hover {
  color: var(--danger);
  background: var(--accent-soft);
}

.new-tab {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 15px;
  line-height: 1;
  flex-shrink: 0;
}

.new-tab:hover {
  color: var(--accent);
  background: var(--accent-soft);
}
</style>

<style>
/* 右键菜单（Teleport 到 body，需要全局样式） */
.tab-menu {
  position: fixed;
  z-index: 120;
  min-width: 168px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tab-menu-item {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-s);
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}

.tab-menu-item:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.tab-menu-item.danger:hover:not(:disabled) {
  background: var(--danger);
  color: #fff;
}

.tab-menu-item:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
