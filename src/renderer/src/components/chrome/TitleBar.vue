<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'

const ui = useUiStore()
const docs = useDocumentsStore()
const api = window.api
</script>

<template>
  <header class="titlebar" @dblclick="api.win.toggleMaximize()">
    <div class="brand">
      <svg class="spark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M12 2c.6 4.8 2.4 7 7.2 7.6-4.8.9-6.6 3.1-7.2 8-0.6-4.9-2.4-7.1-7.2-8C9.6 9 11.4 6.8 12 2z"
          fill="currentColor"
        />
      </svg>
      <span class="wordmark">{{ $t('titlebar.brand') }}</span>
    </div>

    <div class="doc-title">
      <template v-if="docs.active">
        <span class="name">{{ docs.active.isHome ? $t('tabs.home') : docs.active.name }}</span>
        <span v-if="docs.active.dirty" class="dot" :title="$t('titlebar.dirty')" />
      </template>
      <span v-else class="name muted">{{ $t('titlebar.tagline') }}</span>
    </div>

    <div class="win-controls">
      <button class="win-btn" :title="$t('titlebar.minimize')" @click="api.win.minimize()">
        <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 5h10" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="win-btn" :title="ui.maximized ? $t('titlebar.restore') : $t('titlebar.maximize')" @click="api.win.toggleMaximize()">
        <svg v-if="!ui.maximized" viewBox="0 0 10 10" width="10" height="10">
          <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else viewBox="0 0 10 10" width="10" height="10">
          <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1" />
          <path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button class="win-btn close" :title="$t('titlebar.close')" @click="api.win.close()">
        <svg viewBox="0 0 10 10" width="10" height="10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 0 14px;
  background: var(--bg);
  -webkit-app-region: drag;
}

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.spark {
  color: var(--accent);
}

.wordmark {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

/* 居中标题可完全收缩，绝不挤压两侧 */
.doc-title {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  overflow: hidden;
}

.doc-title .name {
  font-size: 12.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-title .muted {
  opacity: 0.7;
}

/* 窗口三键必须始终可见：不收缩、不换行、不被覆盖 */
.win-controls {
  display: flex;
  height: 100%;
  flex-shrink: 0;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 46px;
  min-width: 46px;
  height: 100%;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: var(--text-2);
  transition: background 0.12s;
}

.win-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

.win-btn.close:hover {
  background: var(--danger);
  color: #fff;
}
</style>
