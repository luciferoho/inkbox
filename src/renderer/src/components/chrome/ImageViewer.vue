<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

/** 全屏图片查看器：滚轮缩放（以光标为锚）、拖拽平移、双击复位、Esc 关闭 */
const ui = useUiStore()

const scale = ref(1)
const x = ref(0)
const y = ref(0)
const dragging = ref(false)
const viewerEl = ref<HTMLElement | null>(null)

const transform = computed(() => `translate(${x.value}px, ${y.value}px) scale(${scale.value})`)

function reset(): void {
  scale.value = 1
  x.value = 0
  y.value = 0
}

function close(): void {
  ui.viewerImage = null
}

watch(
  () => ui.viewerImage,
  () => reset()
)

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = Math.min(12, Math.max(0.15, scale.value * factor))
  // 以光标为锚缩放：位移按缩放差补偿
  const rect = viewerEl.value?.getBoundingClientRect()
  if (rect) {
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2
    const k = next / scale.value
    x.value = cx - (cx - x.value) * k
    y.value = cy - (cy - y.value) * k
  }
  scale.value = next
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  dragging.value = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return
  x.value += e.movementX
  y.value += e.movementY
}

function onPointerUp(): void {
  dragging.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.viewerImage) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.viewerImage"
      ref="viewerEl"
      class="img-viewer"
      :class="{ dragging }"
      @wheel="onWheel"
      @click.self="close"
      @dblclick="reset"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <img :src="ui.viewerImage" draggable="false" :style="{ transform }" alt="" />
      <div class="hint">滚轮缩放 · 拖拽移动 · 双击复位 · Esc 关闭</div>
      <button class="close-btn" title="关闭 (Esc)" @click="close">✕</button>
    </div>
  </Teleport>
</template>

<style scoped>
.img-viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(20, 16, 12, 0.88);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.img-viewer.dragging {
  cursor: grabbing;
}

.img-viewer img {
  max-width: 92vw;
  max-height: 92vh;
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-pop);
  transform-origin: center center;
  will-change: transform;
  user-select: none;
}

.hint {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 244, 230, 0.55);
  font-size: 12px;
  letter-spacing: 1px;
}

.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 244, 230, 0.12);
  color: rgba(255, 244, 230, 0.8);
  font-size: 15px;
}

.close-btn:hover {
  background: var(--danger);
  color: #fff;
}
</style>
