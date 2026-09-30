<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

/** 右侧快捷键面板：墨脊键盘图标开关，宽度过渡折叠/展开 */
const ui = useUiStore()

const GROUPS = computed<{ title: string; items: { k: string; d: string }[] }[]>(() => [
  {
    title: t('sc.gCommon'),
    items: [
      { k: 'Ctrl+N', d: t('sc.newDoc') },
      { k: 'Ctrl+O', d: t('sc.openFile') },
      { k: 'Ctrl+Shift+O', d: t('sc.openFolder') },
      { k: 'Ctrl+S', d: t('sc.save') },
      { k: 'Ctrl+Shift+S', d: t('sc.saveAs') },
      { k: 'Ctrl+E', d: t('sc.export') },
      { k: 'Ctrl+W', d: t('sc.closeTab') },
      { k: 'Ctrl+Shift+F', d: t('sc.workspaceSearch') },
      { k: 'Ctrl+Tab / Ctrl+Shift+Tab', d: t('sc.cycleTab') },
      { k: 'Ctrl+\\', d: t('sc.toggleSidebar') },
      { k: 'Ctrl+,', d: t('sc.settings') }
    ]
  },
  {
    title: t('sc.gEdit'),
    items: [
      { k: 'Ctrl+F', d: t('sc.find') },
      { k: 'Ctrl+B', d: t('sc.bold') },
      { k: 'Ctrl+I', d: t('sc.italic') },
      { k: 'Ctrl+K', d: t('sc.link') },
      { k: 'Ctrl+Shift+X', d: t('sc.strike') },
      { k: 'Ctrl+Shift+C', d: t('sc.inlineCode') },
      { k: 'Ctrl+= / Ctrl+-', d: t('sc.heading') },
      { k: 'F8 / F9', d: t('sc.focusTypewriter') }
    ]
  },
  {
    title: t('sc.gWysiwyg'),
    items: [
      { k: 'Tab / Shift+Tab', d: t('sc.indent') },
      { k: 'Esc', d: t('sc.exitCode') },
      { k: 'Ctrl+Enter', d: t('sc.afterCode') }
    ]
  }
])
</script>

<template>
  <aside class="sc-panel">
    <div class="sc-head">
      <span class="sc-heading">{{ $t('sc.title') }}</span>
      <button class="collapse-btn" :title="$t('sc.collapse')" @click="ui.toggleShortcutPanel()">
        <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M3.5 1.5L7 5l-3.5 3.5" />
        </svg>
      </button>
    </div>
    <div class="sc-body">
      <section v-for="g in GROUPS" :key="g.title" class="sc-group">
        <p class="sc-title">{{ g.title }}</p>
        <div v-for="it in g.items" :key="it.k" class="sc-item">
          <span class="sc-keys">
            <kbd v-for="(key, i) in it.k.split(' / ')" :key="i">{{ key }}</kbd>
          </span>
          <span class="sc-desc">{{ it.d }}</span>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sc-panel {
  width: 272px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--border);
}

.sc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 10px 8px 16px;
  flex-shrink: 0;
}

.sc-heading {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--text-2);
}

.collapse-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  color: var(--text-2);
}

.collapse-btn:hover {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.sc-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 14px 16px;
}

.sc-group {
  margin-bottom: 16px;
}

.sc-title {
  font-size: 11px;
  color: var(--text-2);
  letter-spacing: 2px;
  margin: 10px 0 6px;
}

.sc-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
  font-size: 12px;
}

.sc-keys {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  min-width: 104px;
}

.sc-keys kbd {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  white-space: nowrap;
}

.sc-desc {
  color: var(--text-2);
}
</style>
