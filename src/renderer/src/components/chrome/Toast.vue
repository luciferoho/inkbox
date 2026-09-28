<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

/** 轻提示：悬浮在状态栏上方，随 ui.toast 自动显隐 */
const ui = useUiStore()
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="ui.toast" class="toast">{{ ui.toast }}</div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: 42px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 105;
  max-width: min(560px, 80vw);
  padding: 9px 18px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-pop);
  color: var(--text);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
</style>
