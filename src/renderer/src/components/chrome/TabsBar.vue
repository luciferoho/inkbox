<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

const docs = useDocumentsStore()
const ui = useUiStore()

/* ---------- 拖拽：窗口内排序 + 跨窗口移动 + 拖出拆分新窗 ----------
   跨窗口时 dataTransfer 数据不可靠，载荷走主进程登记（drag:begin/take），
   目标窗口 take 成功后主进程向源窗口广播 drag:consumed 移除原标签。 */
const dragId = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
/** 源窗口判定辅助 */
let activeDragTabId: number | null = null
let localHandled = false
let consumedByOtherWindow = false
let detachTimer: number | undefined

/** 别的窗口拖来的标签（自定义 MIME 标记，排除外部应用的纯文本拖拽） */
function hasTabMarker(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes('application/x-inkbox-tab') ?? false
}

function onDragStart(id: number, e: DragEvent): void {
  const tab = docs.tabs.find((t) => t.id === id)
  if (!tab || tab.isHome) return
  window.clearTimeout(detachTimer) // 上一次拖拽的仲裁若还挂着，作废
  dragId.value = id
  activeDragTabId = id
  localHandled = false
  consumedByOtherWindow = false
  e.dataTransfer?.setData('application/x-inkbox-tab', '1')
  e.dataTransfer?.setData('text/plain', String(id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  window.api.drag.begin({
    path: tab.path,
    name: tab.name,
    content: tab.content,
    dirty: tab.dirty
  })
}

function onDragOver(index: number, e: DragEvent): void {
  if (dragId.value === null && !hasTabMarker(e)) return
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
  if (dragId.value !== null) {
    localHandled = true
    if (dropIndex.value !== null) docs.moveTab(dragId.value, dropIndex.value)
  } else if (hasTabMarker(e)) {
    localHandled = true // 源窗口仲裁视角：已被本窗口接住
    void adoptFromOtherWindow(dropIndex.value)
  }
  dragId.value = null
  dropIndex.value = null
}

/* 容器尾部区域（＋按钮附近）也允许放置 = 拖到最后一格 */
function onTrailingDragOver(e: DragEvent): void {
  const cross = dragId.value === null && hasTabMarker(e)
  if (dragId.value === null && !cross) return
  if (!cross) {
    const tabs = (e.currentTarget as HTMLElement).querySelectorAll('.tab')
    const last = tabs[tabs.length - 1] as HTMLElement | undefined
    if (last && e.clientX < last.getBoundingClientRect().right - 2) return
  }
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropIndex.value = docs.tabs.length
}

function onTrailingDrop(e: DragEvent): void {
  if (dragId.value !== null) {
    if (dropIndex.value !== docs.tabs.length) return
    e.preventDefault()
    docs.moveTab(dragId.value, docs.tabs.length)
  } else if (hasTabMarker(e)) {
    e.preventDefault()
    const at = dropIndex.value === docs.tabs.length ? null : dropIndex.value
    void adoptFromOtherWindow(at)
  }
  dragId.value = null
  dropIndex.value = null
}

/** 从别的窗口接住标签：向主进程取载荷（并触发源窗口移除原标签） */
async function adoptFromOtherWindow(index: number | null): Promise<void> {
  const doc = await window.api.drag.take()
  if (doc) docs.adoptDoc(doc, index)
}

/** 标签拆分到新窗口：内容整体转移，本窗直接移除（无需脏确认） */
function detachToWindow(id: number): void {
  const tab = docs.tabs.find((t) => t.id === id)
  if (!tab || tab.isHome) return
  window.api.win.openDoc({
    path: tab.path,
    name: tab.name,
    content: tab.content,
    dirty: tab.dirty
  })
  const name = tab.name
  docs.closeTab(id)
  ui.showToast(t('tabs.detached', { name }))
}

function onDragEnd(e: DragEvent): void {
  dragId.value = null
  dropIndex.value = null
  if (activeDragTabId === null) return
  // consumed 先到：标签已在 onDragConsumed 里移除，收尾即可
  if (consumedByOtherWindow) {
    activeDragTabId = null
    return
  }
  const outside =
    e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight
  // 重叠窗口间 drop 时 dragend 坐标会映射回源窗口内，inside/outside 不可靠，
  // 因此删除只认 consumed：两种收尾都留 300ms 竞态窗口——
  // 被接住 → onDragConsumed 处理；没被接住 → 明确拖出边界才拆新窗，否则仅清理
  const id = activeDragTabId
  const mayDetach = outside && !localHandled
  window.clearTimeout(detachTimer)
  detachTimer = window.setTimeout(() => {
    activeDragTabId = null
    if (mayDetach && !consumedByOtherWindow) {
      detachToWindow(id)
    }
    window.api.drag.end()
  }, 300)
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
const menuEl = ref<HTMLElement | null>(null)

async function openMenu(id: number, e: MouseEvent): Promise<void> {
  if (docs.tabs.find((t) => t.id === id)?.isHome) return // 主页无右键菜单
  menu.open = true
  menu.x = e.clientX
  menu.y = e.clientY
  menu.id = id
  // 边缘钳制：菜单渲染后按实际尺寸收回到窗口内（右缘/下缘各留 8px）
  await nextTick()
  const el = menuEl.value
  if (!el) return
  menu.x = Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8))
  menu.y = Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8))
}

function closeMenu(): void {
  menu.open = false
}

function onMousedown(e: MouseEvent): void {
  const el = e.target as HTMLElement
  if (menu.open && !el.closest('.tab-menu')) closeMenu()
}

/* ---------- ＋按钮位置：标签放不下（横向滚动出现）时吸附到栏右端，
     始终可见可点；放得下时跟随最后一个标签 ---------- */
const tabsOverflow = ref(false)

function measureOverflow(): void {
  const el = tabsScroll.value
  tabsOverflow.value = !!el && el.scrollWidth > el.clientWidth + 1
}

let tabsRO: ResizeObserver | undefined

onMounted(() => {
  window.addEventListener('mousedown', onMousedown)
  window.addEventListener('keydown', onKeydown)
  window.api.drag.onConsumed(onDragConsumed)
  tabsRO = new ResizeObserver(measureOverflow)
  if (tabsScroll.value) tabsRO.observe(tabsScroll.value)
  measureOverflow()
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onMousedown)
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(detachTimer)
  tabsRO?.disconnect()
})

/* 标签增删/改名会改变总宽，下一帧重测 */
watch(
  () => docs.tabs.length,
  () => void nextTick(measureOverflow)
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMenu()
}

/** 主进程广播：本窗口拖出的标签被另一个窗口接住 → 移除原标签 */
function onDragConsumed(): void {
  consumedByOtherWindow = true
  window.clearTimeout(detachTimer)
  const id = activeDragTabId
  activeDragTabId = null
  if (id !== null) docs.closeTab(id)
}

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
    { label: t('tabs.ctxClose'), act: () => void docs.closeIfClean(docs.tabs[idx]) },
    { label: t('tabs.ctxDetach'), act: () => detachToWindow(id) },
    { label: t('tabs.ctxCloseLeft', { n: idx - 1 }), act: () => void docs.closeToLeft(id), disabled: idx <= 1 },
    {
      label: t('tabs.ctxCloseRight', { n: docs.tabs.length - idx - 1 }),
      act: () => void docs.closeToRight(id),
      disabled: idx === docs.tabs.length - 1
    },
    { label: t('tabs.ctxCloseOthers'), act: () => void docs.closeOthers(id), disabled: realCount <= 1 },
    { label: t('tabs.ctxCloseAll'), act: () => void docs.closeAllTabs(), danger: true }
  ]
}
</script>

<template>
  <div class="tabsbar">
      <!-- 主页标签：固定在栏左端（不随标签滚动），纯图标，不可关闭/拖拽 -->
      <button
        class="tab home"
        :class="{ active: docs.activeId === 0 }"
        :title="$t('tabs.home')"
        @click="docs.activateHome()"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">
          <path d="M3.5 9.5L10 4l6.5 5.5" />
          <path d="M5.5 9v6.5h9V9" />
          <path d="M8.5 15.5v-4h3v4" />
        </svg>
      </button>

      <div
        ref="tabsScroll"
        class="tabs"
        @wheel.prevent="onWheel"
        @dragover="onTrailingDragOver"
        @drop="onTrailingDrop"
      >
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
        @dragend="onDragEnd($event)"
        @contextmenu.prevent="openMenu(tab.id, $event)"
      >
        <span class="tab-label">{{ tab.name }}</span>
        <span v-if="tab.dirty" class="dot" :title="$t('tabs.dirty')" />
        <svg
          v-if="tab.id === docs.activeId && !tab.dirty"
          class="tab-close"
          viewBox="0 0 10 10"
          width="9"
          height="9"
          role="button"
          :aria-label="$t('tabs.ctxClose')"
          @click.stop="docs.closeTab(tab.id)"
        >
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <!-- 新建按钮：标签放得下时跟在最后（随标签滚动），放不下时吸附到栏右端 -->
      <button v-if="!tabsOverflow" class="new-tab" :title="$t('tabs.new')" @click="docs.newDoc()">＋</button>
    </div>
    <button v-if="tabsOverflow" class="new-tab pinned" :title="$t('tabs.new')" @click="docs.newDoc()">＋</button>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="menu.open"
        ref="menuEl"
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
  /* 隐藏横向滚动条：3px 的滚动条会把行内容撑高/顶起，造成标签与吸附的＋按钮
     基线错位。滚轮换向（onWheel）与激活标签滚入视野已覆盖可达性 */
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  display: none;
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

/* 吸附态：脱离滚动区，固定在标签栏右端（与 tabsbar 的 flex 布局对齐底部） */
.new-tab.pinned {
  align-self: flex-end;
  margin-bottom: 2px;
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
