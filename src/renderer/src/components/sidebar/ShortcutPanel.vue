<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

/** 右侧快捷键面板：墨脊键盘图标开关，宽度过渡折叠/展开 */
const ui = useUiStore()

const GROUPS: { title: string; items: { k: string; d: string }[] }[] = [
  {
    title: '常用',
    items: [
      { k: 'Ctrl+N', d: '新建文档' },
      { k: 'Ctrl+O', d: '打开文件' },
      { k: 'Ctrl+Shift+O', d: '打开文件夹' },
      { k: 'Ctrl+S', d: '保存' },
      { k: 'Ctrl+Shift+S', d: '另存为' },
      { k: 'Ctrl+W', d: '关闭标签页' },
      { k: 'Ctrl+\\', d: '折叠/展开侧栏' },
      { k: 'Ctrl+,', d: '偏好设置' }
    ]
  },
  {
    title: '编辑与格式',
    items: [
      { k: 'Ctrl+F', d: '查找替换' },
      { k: 'Ctrl+B', d: '粗体' },
      { k: 'Ctrl+I', d: '斜体' },
      { k: 'Ctrl+K', d: '链接' },
      { k: 'Ctrl+Shift+X', d: '删除线' },
      { k: 'Ctrl+Shift+C', d: '行内代码' },
      { k: 'Ctrl+= / Ctrl+-', d: '标题升级 / 降级' },
      { k: 'F8 / F9', d: '专注 / 打字机模式' }
    ]
  },
  {
    title: '即显模式 · 代码块',
    items: [
      { k: 'Tab / Shift+Tab', d: '缩进 / 反缩进' },
      { k: 'Esc', d: '退出代码块' },
      { k: 'Ctrl+Enter', d: '代码块后接续正文' }
    ]
  }
]
</script>

<template>
  <aside class="sc-panel">
    <div class="sc-head">
      <span class="sc-heading">快捷键</span>
      <button class="collapse-btn" title="收起面板" @click="ui.toggleShortcutPanel()">
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
