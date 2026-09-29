<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'

/** 自绘弹框（墨匣纸面风格）：二选一确认框 + 多选弹框（关窗未保存检查等） */
const ui = useUiStore()
const cancelBtn = ref<HTMLButtonElement | null>(null)

function onKeydown(e: KeyboardEvent): void {
  if (ui.confirm) {
    if (e.key === 'Escape') ui.resolveConfirm(false)
    if (e.key === 'Enter') ui.resolveConfirm(true)
    return
  }
  if (ui.choice) {
    if (e.key === 'Escape') ui.resolveChoice('cancel')
    if (e.key === 'Enter') {
      const last = ui.choice.choices[ui.choice.choices.length - 1]
      ui.resolveChoice(last.value)
    }
  }
}

// 弹窗出现时聚焦第一个按钮，保证 Enter/Esc 行为确定
watch(
  () => ui.choice,
  async (c) => {
    if (c) {
      await new Promise((r) => setTimeout(r, 0))
      document.querySelector<HTMLElement>('.choice-dialog .btn')?.focus()
    }
  }
)

/** 多选按钮样式：danger 红、最后一项琥珀主按钮、其余幽灵 */
function choiceClass(index: number): string {
  const choices = ui.choice!.choices
  if (choices[index].danger) return 'ok danger'
  return index === choices.length - 1 ? 'ok' : 'cancel'
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  cancelBtn.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <!-- 二选一确认框 -->
    <Transition name="confirm">
      <div v-if="ui.confirm" class="mask" @click.self="ui.resolveConfirm(false)">
        <section class="dialog" role="alertdialog" :aria-label="ui.confirm.title">
          <div class="icon" :class="{ danger: ui.confirm.danger }">
            <svg v-if="ui.confirm.danger" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M10 4v8" /><circle cx="10" cy="15" r="0.8" fill="currentColor" stroke="none" />
            </svg>
            <svg v-else viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M10 5v6" /><circle cx="10" cy="14.4" r="0.8" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <h2 class="title">{{ ui.confirm.title }}</h2>
          <p class="message">{{ ui.confirm.message }}</p>
          <div class="actions">
            <button ref="cancelBtn" class="btn cancel" @click="ui.resolveConfirm(false)">
              {{ ui.confirm.cancelText }}
            </button>
            <button class="btn ok" :class="{ danger: ui.confirm.danger }" @click="ui.resolveConfirm(true)">
              {{ ui.confirm.okText }}
            </button>
          </div>
        </section>
      </div>
    </Transition>

    <!-- 多选弹框 -->
    <Transition name="confirm">
      <div v-if="ui.choice" class="mask" @click.self="ui.resolveChoice('cancel')">
        <section class="dialog choice-dialog" role="dialog" :aria-label="ui.choice.title">
          <h2 class="title">{{ ui.choice.title }}</h2>
          <p class="message">{{ ui.choice.message }}</p>
          <div class="actions">
            <button
              v-for="(c, i) in ui.choice.choices"
              :key="c.value"
              class="btn"
              :class="choiceClass(i)"
              @click="ui.resolveChoice(c.value)"
            >
              {{ c.text }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(20, 16, 12, 0.42);
  display: grid;
  place-items: center;
}

.dialog {
  width: 400px;
  max-width: calc(100vw - 48px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-pop);
  padding: 22px 24px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent-strong);
  margin-bottom: 12px;
}

.icon.danger {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.title {
  font-size: 14.5px;
  font-weight: 700;
  margin-bottom: 8px;
}

.message {
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  margin-bottom: 18px;
}

.actions {
  display: flex;
  gap: 10px;
  width: 100%;
}

/* 按钮自包含样式：不依赖全局 btn-ghost（其 padding 会与固定高度冲突） */
.btn {
  flex: 1 1 auto;
  min-width: 0;
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
  border-radius: var(--radius-s);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cancel {
  border: 1px solid var(--border);
  color: var(--text-2);
  background: transparent;
}

.cancel:hover {
  border-color: var(--text-2);
  color: var(--text);
}

.ok {
  background: var(--accent);
  color: #fff;
  flex-grow: 1.4; /* 主操作略宽，容纳更长文案 */
}

.ok:hover {
  background: var(--accent-strong);
}

.ok.danger {
  background: var(--danger);
}

.ok.danger:hover {
  filter: brightness(1.08);
}

.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.14s ease;
}

.confirm-enter-active .dialog,
.confirm-leave-active .dialog {
  transition: transform 0.14s ease;
}

.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}

.confirm-enter-from .dialog,
.confirm-leave-to .dialog {
  transform: translateY(6px) scale(0.97);
}
</style>
