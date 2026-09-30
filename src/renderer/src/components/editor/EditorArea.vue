<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import type { RecentFile } from '@shared/types'
import { useDocumentsStore } from '@/stores/documents'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore, type EditorMode } from '@/stores/ui'
import { t } from '@/i18n'
import SourceEditor from './SourceEditor.vue'
import Preview from './Preview.vue'
import WysiwygEditor from './WysiwygEditor.vue'

const docs = useDocumentsStore()
const ws = useWorkspaceStore()
const ui = useUiStore()
const recents = ref<RecentFile[]>([])

const editorRef = ref<InstanceType<typeof SourceEditor> | null>(null)
const previewRef = ref<InstanceType<typeof Preview> | null>(null)

const MODES = computed<{ key: EditorMode; label: string; tip: string }[]>(() => [
  { key: 'wysiwyg', label: t('mode.wysiwyg'), tip: t('mode.tipWysiwyg') },
  { key: 'edit', label: t('mode.edit'), tip: t('mode.tipEdit') },
  { key: 'split', label: t('mode.split'), tip: t('mode.tipSplit') },
  { key: 'preview', label: t('mode.preview'), tip: t('mode.tipPreview') }
])

onMounted(async () => {
  const cfg = await window.api.app.getConfig()
  recents.value = cfg.recent.slice(0, 6)
})

async function refreshRecents(): Promise<void> {
  const cfg = await window.api.app.getConfig()
  recents.value = cfg.recent.slice(0, 6)
}

/* 回到主页（关闭全部标签）时刷新最近列表——打开/保存都会更新它 */
watch(
  () => docs.activeId,
  async (id) => {
    if (id === null || id === 0) await refreshRecents()
  }
)

/** 仅移除一条最近记录（不动文件本身） */
async function removeRecent(path: string): Promise<void> {
  const cfg = await window.api.app.getConfig()
  await window.api.app.setConfig({ recent: cfg.recent.filter((r) => r.path !== path) })
  await refreshRecents()
  ui.showToast(t('welcome.removedRecent'))
}

/** 主页（= 欢迎页）：无活动文档或活动的是主页标签 */
const isHome = computed(() => !docs.active || !!docs.active.isHome)

function recentName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function fileDir(path: string): string {
  const sepIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return sepIdx > 0 ? path.slice(0, sepIdx) : ''
}

/** 相对时间展示 */
function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  if (diff < MIN) return t('welcome.justNow')
  if (diff < HOUR) return t('welcome.minAgo', { n: Math.floor(diff / MIN) })
  if (diff < DAY) return t('welcome.hourAgo', { n: Math.floor(diff / HOUR) })
  if (diff < 7 * DAY) return t('welcome.dayAgo', { n: Math.floor(diff / DAY) })
  const dt = new Date(ts)
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`
}


/** 活动文档所在目录（图片相对路径解析用） */
function activeDocDir(): string | null {
  const p = docs.active?.path
  if (!p) return null
  const sepIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return sepIdx > 0 ? p.slice(0, sepIdx) : null
}

/* 双栏同步滚动（仅 split 模式生效） */
function onEditorSync(line: number, frac: number): void {
  if (ui.editorMode === 'split') previewRef.value?.syncToLine(line, frac)
}
function onPreviewSync(line: number, frac: number): void {
  if (ui.editorMode === 'split') editorRef.value?.syncToLine(line, frac)
}
</script>

<template>
  <main class="editor-area">
    <!-- 主页（欢迎页） -->
    <div v-if="isHome" class="welcome">
      <svg class="hero-spark" viewBox="0 0 24 24" width="56" height="56" aria-hidden="true">
        <path
          d="M12 2c.6 4.8 2.4 7 7.2 7.6-4.8.9-6.6 3.1-7.2 8-0.6-4.9-2.4-7.1-7.2-8C9.6 9 11.4 6.8 12 2z"
          fill="currentColor"
        />
      </svg>
      <h1>{{ $t('welcome.hero') }}</h1>
      <p class="sub">{{ $t('welcome.sub') }}</p>

      <div class="actions">
        <button class="btn-primary" @click="docs.newDoc()">{{ $t('welcome.newDoc') }} <kbd>Ctrl+N</kbd></button>
        <button class="btn-ghost" @click="docs.openFile()">{{ $t('welcome.openFile') }} <kbd>Ctrl+O</kbd></button>
        <button class="btn-ghost" @click="ws.openFolder()">{{ $t('welcome.openFolder') }}</button>
        <button class="btn-ghost" @click="docs.openSample()">{{ $t('welcome.sample') }}</button>
      </div>

      <div v-if="recents.length" class="recent">
        <p class="recent-title">{{ $t('welcome.recent') }}</p>
        <button v-for="r in recents" :key="r.path" class="recent-item" :title="r.path" @click="docs.openPath(r.path)">
          <span class="ri-name">
            {{ recentName(r.path) }}
            <em v-if="relTime(r.ts)" class="ri-time">{{ relTime(r.ts) }}</em>
          </span>
          <span class="ri-dir">{{ fileDir(r.path) }}</span>
          <span
            class="ri-remove"
            role="button"
            :title="$t('welcome.removeRecent')"
            @click.stop="removeRecent(r.path)"
          >
            ✕
          </span>
        </button>
      </div>
      <p v-else class="recent-empty">{{ $t('welcome.recentEmpty1') }}<br />{{ $t('welcome.recentEmpty2') }}</p>
    </div>

    <!-- 纸卡工作区 -->
    <div v-else-if="docs.active" class="paper-scroll">
      <article class="paper">
        <header class="paper-head">
          <div class="meta">
            <span class="doc-name">
              <span class="name-text">{{ docs.active.name }}</span>
              <span v-if="docs.active.dirty" class="dot" />
            </span>
            <span class="doc-path">{{ docs.active.path ?? $t('welcome.unsavedPath') }}</span>
          </div>
          <div class="mode-switch">
            <button
              v-for="m in MODES"
              :key="m.key"
              :class="{ on: ui.editorMode === m.key }"
              :title="m.tip"
              @click="ui.setEditorMode(m.key)"
            >
              {{ m.label }}
            </button>
          </div>
        </header>

        <div class="paper-work">
          <!-- 即显：单栏所见即所得（按需挂载，进入时读取最新内容） -->
          <WysiwygEditor v-if="ui.editorMode === 'wysiwyg'" class="pane" />
          <SourceEditor
            v-show="ui.editorMode === 'edit' || ui.editorMode === 'split'"
            ref="editorRef"
            class="pane pane-editor"
            @scroll-sync="onEditorSync"
          />
          <div v-if="ui.editorMode === 'split'" class="pane-divider" />
          <Preview
            v-show="ui.editorMode === 'preview' || ui.editorMode === 'split'"
            ref="previewRef"
            class="pane pane-preview"
            :content="docs.active.content"
            :doc-dir="activeDocDir()"
            @scroll-sync="onPreviewSync"
          />
        </div>
      </article>
    </div>
  </main>
</template>

<style scoped>
.editor-area {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
}

/* ---------- 主页（欢迎页） ---------- */
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px 32px 56px;
  overflow-y: auto;
}

.hero-spark {
  color: var(--accent);
  margin-bottom: 4px;
}

.welcome h1 {
  font-family: var(--font-serif);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 2px;
}

.sub {
  color: var(--text-2);
  font-size: 13px;
  letter-spacing: 1px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.actions kbd {
  margin-left: 2px;
}

.recent {
  margin-top: 34px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  width: min(460px, 90%);
}

.recent-title {
  font-size: 11px;
  color: var(--text-2);
  letter-spacing: 2px;
  margin-bottom: 6px;
  text-align: center;
}

.recent-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 7px 12px;
  border-radius: var(--radius-s);
  text-align: left;
}

.recent-item:hover {
  background: var(--accent-soft);
}

.ri-name {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
}

.ri-name .ri-time {
  font-style: normal;
  font-size: 11px;
  color: var(--accent-strong);
  flex-shrink: 0;
}

.ri-dir {
  font-size: 11px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 移除记录按钮：悬停显示，仅移除列表项不动文件 */
.recent-item {
  position: relative;
}

.ri-remove {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  color: var(--text-2);
  font-size: 11px;
  opacity: 0;
  cursor: pointer;
  transition: opacity 0.12s;
}

.recent-item:hover .ri-remove {
  opacity: 1;
}

.ri-remove:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

/* 空态占位 */
.recent-empty {
  margin-top: 34px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 2;
  text-align: center;
  opacity: 0.75;
}


/* ---------- 纸卡 ---------- */
/* 外层不滚动：纸卡头部恒定可见，左右栏各自内部滚动 */
.paper-scroll {
  flex: 1;
  overflow: hidden;
  padding: 22px 24px;
  display: flex;
  min-height: 0;
  /* 关键：flex 行布局里的项目必须允许收缩，否则编辑器长行的 min-content
     会把整条布局链撑爆（grid 列被撑宽 → 窗口三键被裁剪） */
  min-width: 0;
}

/* 纸宽为可用宽度百分比；min(620px, 100%) 兜底：视口足够时防过窄，
   视口不足时退化为 100%，绝不撑出横向溢出（同时消除"拖宽死区"） */
.paper {
  flex: 1;
  max-width: max(var(--paper-width, 80%), min(620px, 100%));
  margin: 0 auto;
  height: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.paper-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.doc-name {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  font-size: 13px;
  min-width: 0;
}

.doc-name .name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-path {
  font-size: 11px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.mode-switch button {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

.mode-switch button.on {
  background: var(--surface);
  color: var(--accent-strong);
  font-weight: 600;
}

.paper-work {
  flex: 1;
  display: flex;
  min-height: 0;
}

.pane {
  flex: 1;
  min-width: 0;
  height: 100%;
}

.pane-divider {
  width: 1px;
  margin: 12px 0;
  background: var(--border);
  flex-shrink: 0;
}

/* 窄窗口：压缩留白，保证模式切换器与内容可见 */
@media (max-width: 720px) {
  .paper-scroll {
    padding: 10px;
  }
  .mode-switch button {
    padding: 4px 8px;
  }
  .doc-path {
    display: none;
  }
}
</style>
