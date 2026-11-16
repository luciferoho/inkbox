<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeTextMenu,
  runTextMenuAction,
  textMenu,
  type TextMenuItem
} from '@/editor/text-context-menu'

/** 正文右键菜单（5.8，自绘，与 ImageContextMenu/TableContextMenu 同体系）：
    剪贴板 + 段落转换 + 插入子菜单；条目/快捷键/禁用态在 editor/text-context-menu.ts。

    子菜单 Teleport 到 body 用 fixed 定位（而不是嵌在菜单里绝对定位）：
    菜单本身在窗口矮时是滚动容器，绝对定位子菜单会被裁切并撑出横向滚动条，
    独立浮层可以自由贴边翻转/上移，也不影响主菜单尺寸。 */
const el = ref<HTMLElement | null>(null)
const subEl = ref<HTMLElement | null>(null)
const openSub = ref<string | null>(null)
const subItems = ref<TextMenuItem[]>([])
const subPos = ref<{ left: number; top: number }>({ left: 0, top: 0 })

const PAD = 8
let closeTimer = 0

watch(
  () => textMenu.open,
  async (open) => {
    openSub.value = null
    subItems.value = []
    if (!open) return
    await nextTick()
    const box = el.value
    if (!box) return
    // 窗口矮时菜单内部滚动，先夹位置再限高
    const maxH = window.innerHeight - PAD * 2
    box.style.maxHeight = `${maxH}px`
    const w = box.offsetWidth
    const h = Math.min(box.offsetHeight, maxH)
    textMenu.x = Math.max(PAD, Math.min(textMenu.x, window.innerWidth - w - PAD))
    textMenu.y = Math.max(PAD, Math.min(textMenu.y, window.innerHeight - h - PAD))
  }
)

function cancelClose(): void {
  if (closeTimer) {
    window.clearTimeout(closeTimer)
    closeTimer = 0
  }
}

/** 移出父项后留一小段缓冲，方便指针斜向移进子菜单 */
function scheduleClose(): void {
  cancelClose()
  closeTimer = window.setTimeout(() => {
    openSub.value = null
  }, 160)
}

async function openSubmenu(item: TextMenuItem, evt: MouseEvent): Promise<void> {
  cancelClose()
  openSub.value = item.id
  subItems.value = item.children ?? []
  const itemEl = evt.currentTarget as HTMLElement | null
  const r = itemEl?.getBoundingClientRect()
  const left = r ? r.right - 4 : evt.clientX
  let top = r ? r.top - 8 : evt.clientY
  subPos.value = { left, top }
  await nextTick()
  const sub = subEl.value
  if (!sub) return
  sub.style.maxHeight = ''
  let sr = sub.getBoundingClientRect()
  // 先试「贴合触发项」；下方空间不足则限高滚动（保持与触发项对齐），
  // 空间实在太小（<160px）才整体上移贴底
  const availBelow = window.innerHeight - PAD - top
  if (sr.height > availBelow) {
    if (availBelow >= 160) {
      sub.style.maxHeight = `${availBelow}px`
      sr = sub.getBoundingClientRect()
    } else {
      top = Math.max(PAD, window.innerHeight - PAD - Math.min(sr.height, window.innerHeight - PAD * 2))
    }
  }
  // 右侧放不下 → 翻到触发项左侧
  let finalLeft = left
  if (left + sr.width > window.innerWidth - PAD) {
    finalLeft = Math.max(PAD, (r ? r.left : left) - sr.width + 6)
  }
  subPos.value = { left: finalLeft, top }
}

function closeSub(): void {
  cancelClose()
  openSub.value = null
}

function onDocMousedown(e: MouseEvent): void {
  if (!textMenu.open) return
  const target = e.target instanceof Node ? e.target : null
  if (target && (el.value?.contains(target) || subEl.value?.contains(target))) return
  closeTextMenu()
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && textMenu.open) closeTextMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('blur', closeTextMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('blur', closeTextMenu)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="textMenu.open"
      ref="el"
      class="ctx-menu"
      :style="{ left: `${textMenu.x}px`, top: `${textMenu.y}px` }"
      @contextmenu.prevent
    >
      <template v-for="item in textMenu.items" :key="item.id">
        <div v-if="item.label === '-'" class="ctx-sep" />
        <div
          v-else-if="item.children"
          class="ctx-item has-sub"
          :class="{ active: openSub === item.id }"
          @mouseenter="openSubmenu(item, $event)"
          @mouseleave="scheduleClose()"
        >
          <span>{{ item.label }}</span>
          <span class="ctx-arrow">›</span>
        </div>
        <button
          v-else
          class="ctx-item"
          :class="{ disabled: item.disabled }"
          :disabled="item.disabled"
          @mouseenter="closeSub()"
          @click="runTextMenuAction(item.id)"
        >
          <span>{{ item.label }}</span>
          <span v-if="item.accel" class="ctx-accel">{{ item.accel }}</span>
        </button>
      </template>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="textMenu.open && openSub"
      ref="subEl"
      class="ctx-submenu"
      :style="{ left: `${subPos.left}px`, top: `${subPos.top}px` }"
      @mouseenter="cancelClose()"
      @mouseleave="scheduleClose()"
      @contextmenu.prevent
    >
      <button
        v-for="child in subItems"
        :key="child.id"
        class="ctx-item"
        @click="runTextMenuAction(child.id)"
      >
        <span>{{ child.label }}</span>
        <span v-if="child.accel" class="ctx-accel">{{ child.accel }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 130;
  min-width: 210px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 12, 9, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 只在纵向滚动（子菜单是独立浮层，不会撑出横向滚动条） */
  overflow-x: hidden;
  overflow-y: auto;
}

.ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  color: var(--text-2);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
  width: 100%;
  flex-shrink: 0;
}

.ctx-item:hover:not(.disabled),
.ctx-item.active {
  background: var(--surface-2);
  color: var(--text);
}

.ctx-item.disabled {
  opacity: 0.4;
  cursor: default;
}

.ctx-accel {
  color: var(--text-2);
  font-size: 11.5px;
  letter-spacing: 0.3px;
}

.has-sub {
  cursor: default;
}

.ctx-arrow {
  color: var(--text-2);
  font-size: 13px;
  margin-left: auto;
}

.ctx-submenu {
  position: fixed;
  z-index: 131;
  min-width: 190px;
  max-height: min(400px, calc(100vh - 16px));
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 12, 9, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctx-sep {
  height: 1px;
  margin: 5px 8px;
  background: var(--border);
  flex-shrink: 0;
}
</style>
