<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeTableMenu,
  runTableMenuAction,
  tableMenu,
  tableMenuItems
} from '@/editor/table-context-menu'

/** 表格右键菜单（自绘，双主题）：只负责定位/关闭/渲染，条目与动作在
    editor/table-context-menu.ts（样式与 ImageContextMenu 同源） */
const el = ref<HTMLElement | null>(null)

/* 贴边收进视口：开菜单时按实际尺寸夹取（与 TabsBar 同款） */
watch(
  () => tableMenu.open,
  async (open) => {
    if (!open) return
    await nextTick()
    const box = el.value
    if (!box) return
    tableMenu.x = Math.max(8, Math.min(tableMenu.x, window.innerWidth - box.offsetWidth - 8))
    tableMenu.y = Math.max(8, Math.min(tableMenu.y, window.innerHeight - box.offsetHeight - 8))
  }
)

function onDocMousedown(e: MouseEvent): void {
  if (!tableMenu.open) return
  if (!(e.target instanceof Node) || !el.value?.contains(e.target)) closeTableMenu()
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
      <button
        v-for="item in tableMenuItems()"
        :key="item.action"
        class="tbl-ctx-item"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="runTableMenuAction(item.action)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 材质与图片右键菜单一致（全局 .img-ctx-menu 在 ImageContextMenu.vue，此处 scoped） */
.tbl-ctx-menu {
  position: fixed;
  z-index: 120;
  min-width: 168px;
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

.tbl-ctx-item.danger:hover:not(:disabled) {
  background: var(--danger);
  color: #fff;
}

.tbl-ctx-item:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
