<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

function pick(mode: 'outline' | 'files'): void {
  // 再次点击当前模式 = 折叠侧栏（墨脊保留）
  if (ui.sidebarOpen && ui.sidebarMode === mode) ui.toggleSidebar()
  else ui.setSidebarMode(mode)
}
</script>

<template>
  <nav class="rail">
    <button
      class="rail-btn"
      :class="{ active: ui.sidebarOpen && ui.sidebarMode === 'outline' }"
      title="大纲"
      @click="pick('outline')"
    >
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M3 4.5h7M3 10h5M3 15.5h7" />
        <path d="M12.5 3v14M12.5 4.5H17M12.5 15.5H17" />
      </svg>
    </button>

    <button
      class="rail-btn"
      :class="{ active: ui.sidebarOpen && ui.sidebarMode === 'files' }"
      title="工作区"
      @click="pick('files')"
    >
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
      </svg>
    </button>

    <button class="rail-btn" disabled title="搜索（M2）">
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <circle cx="9" cy="9" r="5.2" />
        <path d="M13 13l4 4" />
      </svg>
    </button>

    <div class="spacer" />

    <button class="rail-btn" title="切换主题 (Ctrl+Alt+T)" @click="ui.toggleTheme()">
      <svg v-if="ui.effectiveTheme === 'light'" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7L14 6M6 14l-1.3 1.3" />
      </svg>
      <svg v-else viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <path d="M16 12.5A6.5 6.5 0 0 1 7.5 4 6.5 6.5 0 1 0 16 12.5z" />
      </svg>
    </button>

    <button
      class="rail-btn"
      :class="{ active: ui.shortcutPanelOpen }"
      title="快捷键说明"
      @click="ui.toggleShortcutPanel()"
    >
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <rect x="2.5" y="5" width="15" height="10" rx="2" />
        <path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M5.5 11h.01M8.5 11h.01M11.5 11h.01M14.5 11h.01M7 13.8h6" />
      </svg>
    </button>

    <button class="rail-btn" title="偏好设置 (Ctrl+,)" @click="ui.openSettings()">
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
        <circle cx="10" cy="10" r="2.6" />
        <path d="M10 2.8l1.1 2 2.3-.4.4 2.3 2 1.1-1.1 2 1.1 2-2 1.1-.4 2.3-2.3-.4-1.1 2-1.1-2-2.3.4-.4-2.3-2-1.1 1.1-2-1.1-2 2-1.1.4-2.3 2.3.4z" />
      </svg>
    </button>
  </nav>
</template>

<style scoped>
.rail {
  width: 52px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  background: var(--bg-rail);
}

.rail-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-m);
  display: grid;
  place-items: center;
  color: var(--rail-icon);
  transition: color 0.12s, background 0.12s;
}

.rail-btn:hover:not(:disabled) {
  color: var(--rail-icon-hover);
  background: rgba(255, 244, 230, 0.08);
}

.rail-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.rail-btn.active {
  color: var(--rail-icon-hover);
  background: rgba(255, 244, 230, 0.1);
}

/* 琥珀左缘指示条 */
.rail-btn.active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}

.spacer {
  flex: 1;
}
</style>
