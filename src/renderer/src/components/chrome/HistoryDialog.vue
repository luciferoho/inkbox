<script setup lang="ts">
import { ref, watch } from 'vue'
import type { HistoryEntry } from '@shared/types'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { t } from '@/i18n'

/**
 * 版本历史对话框（4.1）：左列快照时间线（最新在上），右侧所选快照的
 * 纯文本预览。「回滚到此版本」把快照内容写盘并同步当前标签（可撤销历史
 * 由各编辑器整档重载承接）。
 */
const ui = useUiStore()
const docs = useDocumentsStore()

const entries = ref<HistoryEntry[]>([])
const selected = ref<number | null>(null)
const preview = ref('')
const loading = ref(false)
const restoring = ref(false)

function close(): void {
  ui.historyOpen = false
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

watch(
  () => ui.historyOpen,
  async (open) => {
    if (!open) return
    entries.value = []
    selected.value = null
    preview.value = ''
    const path = docs.active?.path
    if (!path) return
    loading.value = true
    try {
      entries.value = await window.api.history.list(path)
      if (entries.value.length > 0) void select(entries.value[0]!.ts)
    } finally {
      loading.value = false
    }
  }
)

async function select(ts: number): Promise<void> {
  const path = docs.active?.path
  if (!path) return
  selected.value = ts
  loading.value = true
  try {
    preview.value = (await window.api.history.read(path, ts)) ?? ''
  } finally {
    loading.value = false
  }
}

async function restore(): Promise<void> {
  const tab = docs.active
  if (!tab?.path || selected.value === null || restoring.value) return
  const content = await window.api.history.read(tab.path, selected.value)
  if (content === null) {
    ui.showToast(t('history.readFailed'))
    return
  }
  const ok = await ui.askConfirm(
    t('history.restoreTitle'),
    t('history.restoreMsg', { time: fmtTime(selected.value) }),
    { okText: t('history.restore'), danger: true }
  )
  if (!ok) return
  restoring.value = true
  try {
    await window.api.fs.writeFile(tab.path, content)
    // 整档替换：store 内容回快照、清脏，编辑器经 notifyReload 整档重载
    docs.updateContent(tab.id, content)
    tab.savedContent = content
    tab.dirty = false
    ui.saveState = 'clean'
    void window.api.history.snapshot(tab.path, content)
    ui.notifyReload()
    ui.showToast(t('history.restored'))
    close()
  } catch {
    ui.showToast(t('history.restoreFailed'))
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="history-dialog">
      <div v-if="ui.historyOpen" class="mask" @click.self="close">
        <div class="dialog">
          <header class="head">
            <h3>{{ $t('history.title') }}</h3>
            <p class="sub">{{ docs.active?.name }}</p>
            <button class="close" :title="$t('common.cancel')" @click="close">✕</button>
          </header>
          <div class="body">
            <aside class="list">
              <p v-if="entries.length === 0 && !loading" class="empty">{{ $t('history.empty') }}</p>
              <button
                v-for="e in entries"
                :key="e.ts"
                class="entry"
                :class="{ on: selected === e.ts }"
                @click="select(e.ts)"
              >
                <span class="time">{{ fmtTime(e.ts) }}</span>
                <span class="size">{{ fmtSize(e.size) }}</span>
              </button>
            </aside>
            <section class="preview">
              <pre v-if="preview">{{ preview }}</pre>
              <p v-else-if="!loading" class="empty">{{ $t('history.empty') }}</p>
            </section>
          </div>
          <footer class="foot">
            <button class="btn-restore" :disabled="selected === null || restoring" @click="restore">
              {{ $t('history.restore') }}
            </button>
            <button class="btn-close" @click="close">{{ $t('common.cancel') }}</button>
          </footer>
        </div>
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
  width: min(860px, calc(100vw - 72px));
  height: min(600px, calc(100vh - 96px));
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.head h3 {
  font-size: 15px;
  font-weight: 600;
}

.head .sub {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 12px;
}

.close:hover {
  background: var(--surface-2);
  color: var(--text);
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.list {
  width: 236px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.entry {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-s);
  text-align: left;
}

.entry:hover {
  background: var(--rail-hover);
}

.entry.on {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.entry .time {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.entry .size {
  font-size: 11px;
  color: var(--text-2);
  flex-shrink: 0;
}

.preview {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 14px 18px;
}

.preview pre {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.btn-restore {
  padding: 7px 18px;
  border-radius: var(--radius-s);
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.btn-restore:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn-restore:not(:disabled):hover {
  background: var(--accent-strong);
}

.btn-close {
  padding: 7px 18px;
  border-radius: var(--radius-s);
  border: 1px solid var(--border);
  color: var(--text-2);
  font-size: 13px;
}

.btn-close:hover {
  background: var(--surface-2);
  color: var(--text);
}

.empty {
  color: var(--text-2);
  font-size: 12.5px;
  padding: 24px 0;
  text-align: center;
}

.history-dialog-enter-active,
.history-dialog-leave-active {
  transition: opacity 0.16s;
}

.history-dialog-enter-active .dialog,
.history-dialog-leave-active .dialog {
  transition: transform 0.16s;
}

.history-dialog-enter-from,
.history-dialog-leave-to {
  opacity: 0;
}

.history-dialog-enter-from .dialog,
.history-dialog-leave-to .dialog {
  transform: translateY(10px);
}
</style>
