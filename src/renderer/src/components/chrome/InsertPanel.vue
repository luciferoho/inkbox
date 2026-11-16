<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'
import {
  INSERT_COMMANDS,
  detectInsertTarget,
  runInsertCommand,
  type InsertTarget
} from '@/editor/insert-commands'

/**
 * 插入面板（ROADMAP 5.4）：Ctrl+Shift+P / 右键「插入」子菜单呼出的过滤式
 * 插入命令面板。命令层在 editor/insert-commands.ts（即显/源码双实现）。
 * 不做斜杠字符触发——`/` 是正文常用字符，面板只由快捷键/菜单唤起。
 */

const ui = useUiStore()

const query = ref('')
const active = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const composing = ref(false)
/** 打开瞬间捕捉焦点编辑器（面板 input 抢焦点之前） */
let target: InsertTarget = 'pm'

/** 命令 labelKey 是动态串，走 string 签名取词条（键由 INSERT_COMMANDS 静态保证） */
const tl = (k: string): string => (t as unknown as (key: string) => string)(k)

const hits = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return INSERT_COMMANDS
  return INSERT_COMMANDS.filter((c) => tl(c.labelKey).toLowerCase().includes(q) || c.id.includes(q))
})

watch([query, hits], () => {
  active.value = 0
})

watch(active, async () => {
  await nextTick()
  listEl.value
    ?.querySelector('[data-ip-index="' + active.value + '"]')
    ?.scrollIntoView({ block: 'nearest' })
})

watch(
  () => ui.insertPanelOpen,
  async (open) => {
    if (!open) return
    target = detectInsertTarget()
    query.value = ''
    active.value = 0
    await nextTick()
    inputEl.value?.focus()
  }
)

function move(delta: number): void {
  const n = hits.value.length
  if (n === 0) return
  active.value = (active.value + delta + n) % n
}

function run(cmd?: { id: string }): void {
  const c = cmd ?? hits.value[active.value]
  if (!c) return
  ui.insertPanelOpen = false
  runInsertCommand(c.id, target)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing || composing.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    ui.insertPanelOpen = false
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    run()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.insertPanelOpen" class="ip-mask" @mousedown.self="ui.insertPanelOpen = false">
      <div class="ip-panel" role="dialog" :aria-label="$t('ip.title')">
        <input
          ref="inputEl"
          v-model="query"
          class="ip-input"
          type="text"
          :placeholder="$t('ip.placeholder')"
          spellcheck="false"
          @keydown="onKeydown"
          @compositionstart="composing = true"
          @compositionend="composing = false"
        />
        <ul v-if="hits.length" class="ip-list" ref="listEl">
          <li
            v-for="(cmd, i) in hits"
            :key="cmd.id"
            class="ip-item"
            :class="{ active: i === active }"
            :data-ip-index="i"
            @mouseenter="active = i"
            @mousedown.prevent="run(cmd)"
          >
            <span class="ip-name">{{ tl(cmd.labelKey) }}</span>
          </li>
        </ul>
        <div v-else class="ip-hint">{{ $t('ip.noMatch') }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.ip-mask {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.ip-panel {
  width: min(340px, calc(100vw - 48px));
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ip-input {
  height: 40px;
  padding: 0 14px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 13.5px;
  outline: none;
}

.ip-hint {
  padding: 16px 14px;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: center;
}

.ip-list {
  max-height: 50vh;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ip-item {
  padding: 7px 12px;
  border-radius: var(--radius-s);
  cursor: pointer;
}

.ip-item.active {
  background: var(--accent-soft);
}

.ip-name {
  color: var(--text);
  font-size: 13px;
}

.ip-item.active .ip-name {
  color: var(--accent-strong);
}
</style>
