<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
import { renderWithDir } from '@/services/markdown'
import { htmlToMarkdown } from '@/services/richPaste'
import { t } from '@/i18n'

/**
 * 更新弹窗（update:state 单源驱动）：
 * - available：新版本号 + Release Notes（markdown 渲染）+「立即更新」
 * - downloading：实时进度条 + 速度；可关闭（右上角图标可随时回到本弹窗）
 * - downloaded：「立即安装」——落盘未保存内容 → 主进程写恢复标记 → 静默安装并重启，
 *   重启后经崩溃恢复路径还原未保存内容（session.ts 更新重启标记）
 * - 强制更新（Release notes 含标记）：无关闭按钮、遮罩/Esc 不可关，进入即自动下载
 */
const ui = useUiStore()
const docs = useDocumentsStore()

const s = computed(() => ui.updateState)
const open = computed(() => ui.updateDialogOpen)

/** 强制更新：任何途径都不可关闭弹窗 */
const locked = computed(() => s.value.force && s.value.phase !== 'idle')

/**
 * 更新内容渲染：electron-updater 的 GitHub notes 可能是 GitHub 渲染后的 HTML
 * （body_html 风格,含 <p>/<h2>/<ul>），先经 turndown 转回 markdown,再走统一
 * markdown-it 管线（原始 HTML 仍一律转义）。
 */
const notesHtml = ref('')

type NotesKind = 'new' | 'improve' | 'fix' | 'other'

/** 分节标题归类：发布说明约定用「新增/优化/修复」三段（英文 New/Improvements/Fixes 同样认） */
function notesSectionKind(raw: string): NotesKind {
  // 去掉标题记号、前导符号/emoji 与结尾标点再比对
  const s = raw
    .replace(/^[\s#*_~-]+/u, '')
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '')
    .replace(/[：:，,。.！!；;\s]+$/u, '')
    .trim()
    .toLowerCase()
  if (/^(新增|新功能|新特性|features?|new|added|what'?s new)$/.test(s)) return 'new'
  if (/^(优化|改进|增强|提升|improvements?|enhancements?|changed|changes)$/.test(s)) return 'improve'
  if (/^(修复|修正|补丁|fix(es|ed)?|bug ?fix(es)?)$/.test(s)) return 'fix'
  return 'other'
}

/**
 * 把说明按节拆成 <section class="ns ns-新增类">：标题独立成一行（主色标记 + 名称 + 条目数），
 * 正文条目才有呼吸感、三节也一眼可分。只搬动节点、不改内容（名称走 textContent，无注入面）。
 * 没有可识别的分节标题时原样返回，退回普通排版。
 */
function decorateNotes(html: string): string {
  if (!html) return html
  const doc = new DOMParser().parseFromString(`<div id="ib-notes">${html}</div>`, 'text/html')
  const root = doc.getElementById('ib-notes')
  if (!root) return html
  const kids = Array.from(root.children)
  /** 分节标题：h1-h6，或「整段只有一个加粗词」的段落（部分发布说明用 **新增** 当标题） */
  const headingKind = (el: Element): NotesKind | null => {
    const tag = el.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) return notesSectionKind(el.textContent ?? '')
    if (tag === 'p' && el.children.length === 1 && el.firstElementChild?.tagName === 'STRONG') {
      const k = notesSectionKind(el.firstElementChild.textContent ?? '')
      if (k !== 'other') return k
    }
    return null
  }
  if (!kids.some((el) => headingKind(el) !== null)) return html

  const frag = doc.createDocumentFragment()
  let sec: HTMLElement | null = null
  let pre: HTMLElement | null = null
  for (const el of kids) {
    const kind = headingKind(el)
    if (kind) {
      sec = doc.createElement('section')
      sec.className = `ns ns-${kind}`
      const head = doc.createElement('div')
      head.className = 'ns-head'
      const name = doc.createElement('span')
      name.className = 'ns-name'
      name.textContent = (el.textContent ?? '').trim()
      head.append(name)
      sec.append(head)
      frag.append(sec)
      continue
    }
    if (sec) {
      sec.append(el)
    } else {
      // 第一个分节标题之前的内容（简介等）保持原样
      pre ??= (() => {
        const d = doc.createElement('div')
        d.className = 'ns-pre'
        frag.append(d)
        return d
      })()
      pre.append(el)
    }
  }

  for (const s of frag.querySelectorAll('section.ns')) {
    const n = s.querySelectorAll('li').length
    if (n > 0) {
      const chip = doc.createElement('span')
      chip.className = 'ns-count'
      chip.textContent = t('updater.notesCount', { n })
      s.querySelector('.ns-head')?.append(chip)
    }
  }
  const holder = doc.createElement('div')
  holder.append(frag)
  return holder.innerHTML
}

watch(
  () => s.value.notes,
  async (notes) => {
    if (!notes) {
      notesHtml.value = ''
      return
    }
    const looksHtml = /<\/(p|h[1-6]|ul|ol|li|blockquote|code)>|<br\s*\/?>/i.test(notes)
    const mdSrc = looksHtml ? ((await htmlToMarkdown(notes)) ?? notes) : notes
    notesHtml.value = decorateNotes(renderWithDir(mdSrc, null))
  },
  { immediate: true }
)

const speedText = computed(() => {
  const mb = s.value.bps / 1048576
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.max(1, Math.round((s.value.bps / 1024)))} KB/s`
})

const installing = ref(false)

/** 点击更新后的连接空窗（download-progress 首个事件前）：立即给出反馈,防重复点击 */
const startingDownload = ref(false)

/** 连接中（已点击但尚无进度数据）：进度条显示流动动画 */
const connecting = computed(() => startingDownload.value && s.value.phase === 'downloading' && s.value.percent === 0)

/** 发布时间格式化（精确到分,本地时区） */
const releaseDateText = computed(() => {
  const iso = s.value.releaseDate
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

/** 跳过此版本：记录版本号并关闭（设置里手动检查不受影响） */
function skipVersion(): void {
  if (!s.value.version) return
  ui.skipUpdate(s.value.version)
  ui.updateDialogOpen = false
}

watch(
  () => s.value.phase,
  (phase) => {
    if (phase !== 'downloading') startingDownload.value = false
  }
)

function onUpdate(): void {
  if (s.value.phase !== 'available' || startingDownload.value) return
  startingDownload.value = true
  // 乐观切到下载态（真实进度事件到达后由主进程状态覆盖）
  ui.updateState = { ...s.value, phase: 'downloading', percent: 0, bps: 0 }
  void window.api.update.download()
}

/** 重试检查（错误态按钮） */
function retryCheck(): void {
  if (s.value.phase !== 'error') return
  void window.api.update.check()
}

function close(): void {
  if (locked.value) return
  ui.updateDialogOpen = false
}

function onKeydown(e: KeyboardEvent): void {
  if (!open.value) return
  if (e.key === 'Escape' && !locked.value) close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/** 安装 = 落盘未保存内容与会话 → 主进程写恢复标记 → 静默安装并重启 */
async function onInstall(): Promise<void> {
  if (installing.value) return
  installing.value = true
  try {
    await docs.flushDrafts()
    await docs.persistSessionNow()
    await window.api.update.install()
  } catch {
    installing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="update">
      <div v-if="open" class="mask" @click.self="close()">
        <section
          class="dialog update-dialog"
          :class="{ wide: s.phase === 'available' && !!notesHtml }"
          role="alertdialog"
          :aria-label="$t('updater.title')"
        >
          <header class="head">
            <h2 class="title">
              {{ s.phase === 'downloaded' ? $t('updater.readyTitle') : $t('updater.title') }}
              <span v-if="s.force" class="force">{{ $t('updater.forced') }}</span>
            </h2>
            <button v-if="!locked" class="close" :title="$t('updater.close')" @click="close()">✕</button>
          </header>

          <!-- 检查中 -->
          <p v-if="s.phase === 'checking'" class="phase-line">{{ $t('updater.checking') }}</p>

          <!-- 发现新版本 -->
          <template v-else-if="s.phase === 'available'">
            <div class="rel-head">
              <span class="rel-lead">{{ $t('updater.availableLead') }}</span>
              <span class="ver-hl">v{{ s.version }}</span>
              <span v-if="releaseDateText" class="rel-date">{{ $t('updater.releasedAt', { date: releaseDateText }) }}</span>
            </div>
            <p v-if="s.force" class="hint">{{ $t('updater.forcedHint') }}</p>
            <div v-if="notesHtml" class="update-notes" v-html="notesHtml" />
            <div class="actions">
              <button v-if="!s.force" class="btn ghost" @click="skipVersion()">{{ $t('updater.skipVersion') }}</button>
              <button v-if="!s.force" class="btn ghost" @click="close()">{{ $t('updater.later') }}</button>
              <button class="btn primary" :disabled="startingDownload" @click="onUpdate()">
                {{ startingDownload ? $t('updater.preparing') : $t('updater.downloadNow') }}
              </button>
            </div>
          </template>

          <!-- 下载中 -->
          <template v-else-if="s.phase === 'downloading'">
            <p class="lead">
              <span class="lead-t">{{ $t('updater.downloadingLead') }}</span>
              <span class="ver-hl">v{{ s.version }}</span>
            </p>
            <div class="progress">
              <div class="bar" :class="{ indeterminate: connecting }" :style="connecting ? {} : { width: s.percent + '%' }" />
            </div>
            <p class="meta">
              <span v-if="connecting">{{ $t('updater.connecting') }}</span>
              <span v-else>{{ s.percent }}%</span>
              <span v-if="!connecting">{{ speedText }}</span>
            </p>
            <p v-if="!s.force" class="hint">{{ $t('updater.downloadHint') }}</p>
            <p v-else class="hint">{{ $t('updater.forcedHint') }}</p>
            <div class="actions">
              <button v-if="!locked" class="btn ghost" @click="close()">{{ $t('updater.hide') }}</button>
            </div>
          </template>

          <!-- 已下载待装 -->
          <template v-else-if="s.phase === 'downloaded'">
            <p class="lead">
              <span class="ver-hl">v{{ s.version }}</span>
              <span class="lead-t">{{ $t('updater.downloadedLead') }}</span>
            </p>
            <p class="hint">{{ $t('updater.restoreHint') }}</p>
            <div class="actions">
              <button v-if="!s.force" class="btn ghost" @click="close()">{{ $t('updater.later') }}</button>
              <button class="btn primary" :disabled="installing" @click="onInstall()">
                {{ installing ? $t('updater.installing') : $t('updater.installNow') }}
              </button>
            </div>
          </template>

          <!-- 出错 -->
          <template v-else-if="s.phase === 'error'">
            <p class="lead">{{ $t('updater.failed') }}</p>
            <p class="err-detail">{{ s.error }}</p>
            <div class="actions">
              <button v-if="!s.force" class="btn ghost" @click="close()">{{ $t('updater.close') }}</button>
              <button class="btn primary" @click="retryCheck()">{{ $t('updater.retry') }}</button>
            </div>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 12, 9, 0.45);
  display: grid;
  place-items: center;
}

.dialog {
  width: min(520px, calc(100vw - 48px));
  max-height: min(80vh, 660px);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15, 12, 9, 0.28);
  padding: 20px 22px;
}

/* 只有「发现新版本 + 更新说明」这一屏内容多，给宽一点；下载/已下载/出错仍用紧凑宽度 */
.dialog.wide {
  width: min(620px, calc(100vw - 48px));
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15.5px;
  font-weight: 700;
  margin: 0;
}

.ver {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 8px;
  border-radius: 999px;
}

.force {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--danger);
  padding: 1px 8px;
  border-radius: 999px;
}

.close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}

.close:hover {
  background: var(--surface-2);
  color: var(--text);
}

.lead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 10px;
  font-size: 13px;
  color: var(--text);
}

.lead-t {
  font-weight: 600;
}

/* 版本号高亮 */
.ver-hl {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  padding: 2px 10px;
  border-radius: 999px;
}

/* 「发现新版本 vX.Y.Z —— 发布日期」一行：版本靠左、日期推到右侧当次要信息 */
.rel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 2px 0 12px;
}

.rel-lead {
  font-size: 13px;
  color: var(--text-2);
}

.rel-date {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.phase-line {
  margin: 8px 0;
  font-size: 13px;
  color: var(--text-2);
}

/* ---------- 更新内容：按「新增/优化/修复」分节 ---------- */
.update-notes {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 12px;
  background: var(--surface);
  /* 顶部不留内边距：否则吸顶标题和滚动区顶边之间会漏一条缝、正文从缝里透出来（分节头自带 12px 上边距） */
  padding: 0 18px 14px;
  font-size: 13px;
  line-height: 1.78;
  color: var(--text);
  overscroll-behavior: contain;
}

/* 分节：每节一个主色标记（新增=主色 / 优化=暖琥珀 / 修复=警示色，均随明暗主题自动调深浅） */
.update-notes :deep(.ns) {
  --ns-c: var(--text-2);
  padding: 0 0 2px;
}

.update-notes :deep(.ns-new) {
  --ns-c: var(--accent-strong);
}

.update-notes :deep(.ns-improve) {
  --ns-c: color-mix(in srgb, #c98b2e 62%, var(--text));
}

.update-notes :deep(.ns-fix) {
  --ns-c: var(--danger);
}

.update-notes :deep(.ns + .ns) {
  margin-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

/* 分节头：滚动时吸顶，长说明滚到一半也知道自己在哪一节 */
.update-notes :deep(.ns-head) {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 12px 0 6px;
  background: var(--surface);
}

/* 吸顶时把内容区左右内边距也一起盖住：正文在滚动容器里会从 padding 区域透出来 */
.update-notes :deep(.ns-head::before) {
  content: '';
  position: absolute;
  inset: 0 -18px;
  z-index: -1;
  background: var(--surface);
}

/* 标题下沿渐隐 10px：吸顶时紧跟其后的条目会被切一半，淡出比硬切看着自然 */
.update-notes :deep(.ns-head::after) {
  content: '';
  position: absolute;
  left: -18px;
  right: -18px;
  bottom: -10px;
  height: 10px;
  z-index: -1;
  background: linear-gradient(var(--surface), transparent);
}

.update-notes :deep(.ns-name) {
  position: relative;
  padding-left: 12px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--ns-c);
}

.update-notes :deep(.ns-name::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: var(--ns-c);
}

.update-notes :deep(.ns-count) {
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-2);
  background: var(--surface-2);
  border-radius: 999px;
  padding: 0 7px;
  font-variant-numeric: tabular-nums;
}

.update-notes :deep(h1),
.update-notes :deep(h2),
.update-notes :deep(h3),
.update-notes :deep(h4) {
  color: var(--text);
  font-size: 13px;
  margin: 12px 0 6px;
}

.update-notes :deep(p) {
  margin: 6px 0;
}

.update-notes :deep(.ns-pre) {
  color: var(--text-2);
  padding-top: 8px;
}

.update-notes :deep(ul),
.update-notes :deep(ol) {
  margin: 4px 0 2px;
  padding-left: 20px;
}

.update-notes :deep(li) {
  margin: 0 0 9px;
  padding-left: 2px;
}

.update-notes :deep(li:last-child) {
  margin-bottom: 4px;
}

.update-notes :deep(li::marker) {
  color: var(--ns-c);
}

/* 条目的加粗小标题（「**表情选择器**：…」）提到正文色，扫读时一眼抓住关键词 */
.update-notes :deep(li > strong:first-child) {
  color: var(--text);
  font-weight: 600;
}

.update-notes :deep(blockquote) {
  margin: 10px 0 2px;
  padding: 7px 12px;
  border-left: 3px solid color-mix(in srgb, var(--accent) 55%, transparent);
  background: var(--surface-2);
  border-radius: 0 6px 6px 0;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.7;
}

.update-notes :deep(code) {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 11.5px;
  background: var(--surface-2);
  border-radius: 4px;
  padding: 0 4px;
}

.progress {
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
  margin: 10px 0 6px;
}

.bar {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.25s ease;
}

/* 连接中:宽度固定,左右滑动动画 */
.bar.indeterminate {
  width: 30%;
  animation: indeterminate-slide 1.1s ease-in-out infinite;
}

@keyframes indeterminate-slide {
  0% {
    margin-left: -30%;
  }
  100% {
    margin-left: 100%;
  }
}

.meta {
  display: flex;
  justify-content: space-between;
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-2);
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-2);
}

.err-detail {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--danger);
  word-break: break-all;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

.btn {
  height: 32px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 12.5px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  transition:
    background 0.12s,
    border-color 0.12s;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: 0 1px 2px rgba(15, 12, 9, 0.18);
}

.btn.primary:hover:not(:disabled) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

.btn.primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn.ghost:hover {
  background: var(--surface-2);
}

.update-enter-active,
.update-leave-active {
  transition: opacity 0.16s ease;
}

.update-enter-from,
.update-leave-to {
  opacity: 0;
}
</style>
