<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { textStats } from '@/utils/text'
import { t } from '@/i18n'

const ui = useUiStore()
const docs = useDocumentsStore()

const stats = computed(() => textStats(docs.active?.content ?? ''))

const docOpen = computed(() => !!docs.active && !docs.active.isHome)

/** 保存状态：未保存 / 已保存 HH:mm:ss（实时反映，替代易过期的文本提示） */
const saveLabel = computed(() => {
  if (!docOpen.value || ui.saveState === 'clean') return ''
  if (ui.saveState === 'dirty') return t('status.unsaved')
  const time = new Date(ui.savedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return t('status.savedAt', {
    time: `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`
  })
})
</script>

<template>
  <footer class="statusbar">
    <div class="left">
      <span v-if="ui.vimMode" class="vim-chip" :class="{ ins: ui.vimInsert }" :title="$t('status.vimTitle')">
        {{ ui.vimInsert ? 'INSERT' : 'NORMAL' }}
      </span>
      <span v-if="saveLabel" class="save-state" :class="{ dirty: ui.saveState === 'dirty' }">
        <i class="pip" />{{ saveLabel }}
      </span>
      <template v-if="docOpen">
        <span class="sep">·</span>
        <span :title="t('status.lineTitle', { n: ui.currentLine })">{{ t('status.words', { n: stats.words.toLocaleString() }) }}</span>
        <span class="sep">·</span>
        <span>{{ t('status.chars', { n: stats.chars.toLocaleString() }) }}</span>
        <span class="sep">·</span>
        <span>{{ stats.minutes ? t('status.readMin', { n: stats.minutes }) : '—' }}</span>
      </template>
    </div>
    <div class="right">
      <button
        class="badge toggle"
        :class="{ on: ui.focusMode }"
        :title="$t('status.focusTitle')"
        @click="ui.toggleFocus()"
      >
        {{ $t('status.focus') }}
      </button>
      <button
        class="badge toggle"
        :class="{ on: ui.typewriterMode }"
        :title="$t('status.typewriterTitle')"
        @click="ui.toggleTypewriter()"
      >
        {{ $t('status.typewriter') }}
      </button>
      <span class="badge">Markdown</span>
      <span class="badge">UTF-8</span>
      <span class="badge" :class="{ ok: ui.autosaveEnabled }">
        <i class="pip" />{{ ui.autosaveEnabled ? $t('status.autosaveOn') : $t('status.autosaveOff') }}
      </span>
    </div>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  color: var(--text-2);
  font-size: 12px;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sep {
  opacity: 0.5;
}

/* 保存状态胶囊 */
.save-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ok);
}

/* Vim 模式徽标：等宽键帽风，普通态灰、插入态琥珀 */
.vim-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-2);
  background: var(--surface-2);
}

.vim-chip.ins {
  color: var(--accent-strong);
  border-color: var(--accent);
}

.save-state.dirty {
  color: var(--accent-strong);
}

.save-state .pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.badge.toggle {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}

.badge.toggle:hover {
  color: var(--text);
  background: var(--surface-2);
}

.badge.toggle.on {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-2);
  opacity: 0.5;
}

.badge.ok .pip {
  background: var(--ok);
  opacity: 1;
}
</style>
