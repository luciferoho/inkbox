<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeImageMenu,
  imageMenu,
  imageMenuItems,
  runImageMenuAction
} from '@/editor/image-context-menu'

/** 图片右键菜单（自绘，双主题）：样式与 tab-menu 同源（CSS 变量），替代原生菜单。
    只负责定位/关闭/渲染，条目与动作在 editor/image-context-menu.ts */
const el = ref<HTMLElement | null>(null)

/* 贴边收进视口：开菜单时按实际尺寸夹取（与 TabsBar 同款） */
watch(
  () => imageMenu.open,
  async (open) => {
    if (!open) return
    await nextTick()
    const box = el.value
    if (!box) return
    imageMenu.x = Math.max(8, Math.min(imageMenu.x, window.innerWidth - box.offsetWidth - 8))
    imageMenu.y = Math.max(8, Math.min(imageMenu.y, window.innerHeight - box.offsetHeight - 8))
  }
)

function onDocMousedown(e: MouseEvent): void {
  if (!imageMenu.open) return
  if (!(e.target instanceof Node) || !el.value?.contains(e.target)) closeImageMenu()
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && imageMenu.open) closeImageMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('blur', closeImageMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('blur', closeImageMenu)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="imageMenu.open"
      ref="el"
      class="img-ctx-menu"
      :style="{ left: `${imageMenu.x}px`, top: `${imageMenu.y}px` }"
      @contextmenu.prevent
    >
      <button
        v-for="item in imageMenuItems(imageMenu.src)"
        :key="item.action"
        class="img-ctx-item"
        @click="runImageMenuAction(item.action, imageMenu.src)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 材质与即显元素工具条（el-toolbar）完全一致：纸面底、8px 圆角、同款投影 */
.img-ctx-menu {
  position: fixed;
  z-index: 120;
  min-width: 168px;
  padding: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 12, 9, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.img-ctx-item {
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

.img-ctx-item:hover {
  background: var(--surface-2);
  color: var(--text);
}
</style>
