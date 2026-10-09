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
      <!-- 更新下载指示：下载中显示进度，已就绪着色；点击重开更新弹窗 -->
      <button
        v-if="ui.updateState.phase === 'downloading' || ui.updateState.phase === 'downloaded'"
        class="win-btn update-indicator"
        :class="{ ready: ui.updateState.phase === 'downloaded' }"
        :title="ui.updateState.phase === 'downloaded'
          ? $t('titlebar.updateReady')
          : $t('titlebar.updateDownloading', { percent: ui.updateState.percent })"
        @click="ui.updateDialogOpen = true"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M12 3v10m0 0l-4-4m4 4l4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <span v-if="ui.updateState.phase === 'downloading'" class="pct">{{ ui.updateState.percent }}%</span>
      </button>
      <button
        class="win-btn"
        :class="{ pinned: ui.alwaysOnTop }"
        :title="ui.alwaysOnTop ? $t('titlebar.unpin') : $t('titlebar.pin')"
        @click="api.win.toggleAlwaysOnTop()"
      >
        <svg class="pin" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path d="M12 17v5" />
          <path
            d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"
          />
        </svg>
      </button>
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

/* 固定窗口：未固定时图钉斜置，固定后立起并着强调色 */
.win-btn .pin {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.win-btn.pinned {
  color: var(--accent);
}

.win-btn.pinned:hover {
  color: var(--accent);
}

/* 更新下载指示：下载中常规色+百分比,已就绪琥珀色 */
.win-btn.update-indicator {
  /* 覆盖 .win-btn 的 grid:图标与百分比横向排列,与其他窗口按钮同高对齐 */
  width: 78px;
  min-width: 78px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 8px;
}

.win-btn.update-indicator .pct {
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.win-btn.update-indicator.ready {
  width: 46px;
  min-width: 46px;
  padding: 0;
  color: var(--accent);
}

.win-btn.update-indicator.ready:hover {
  color: var(--accent);
}
</style>
