<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { buildExportHtml } from '@/services/exporter'
import { mdToLaTeX } from '@/services/latex'
import { t } from '@/i18n'
// pdf.js 按需加载 + 独立 worker 资源（Electron iframe 内嵌 PDF 查看器不可靠，自渲染最稳）
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** 预览最多渲染的页数（完整内容以导出为准） */
const PREVIEW_MAX_PAGES = 5

/**
 * 导出对话框：左侧设置（文件名/格式/页边距/方向），右侧实时预览实际产物——
 * HTML 直接 srcdoc；PDF 走主进程 printToPDF 返回真实文件交给内置查看器。
 * 设置变化防抖 600ms 重新生成预览。
 */
const ui = useUiStore()
const docs = useDocumentsStore()

type ExportFmt = 'html' | 'pdf' | 'png' | 'latex'
const fmt = ref<ExportFmt>('html')
/** 按标签记忆导出格式：开关弹窗保留所选，关标签即清除（下方 watch 剪枝） */
const fmtByTab = new Map<number, ExportFmt>()
/** 新标签的默认格式 = 列表第一个 */
const FMT_DEFAULT: ExportFmt = 'png'
const margin = ref<'normal' | 'narrow' | 'none'>('normal')
const landscape = ref(false)
const pageNumbers = ref(false)
const fileName = ref('')
const busy = ref(false)
const previewHtml = ref('')
const previewFailed = ref(false)
const generating = ref(false)
/** LaTeX 格式的实时转换预览（等宽文本展示） */
const texPreview = ref('')
const pdfHost = ref<HTMLElement | null>(null)
/** PDF 预览页数提示（超过上限时显示） */
const pdfPageHint = ref('')
/** 导出失败的真实原因（弹窗内醒目展示，不再只靠一闪而过的 Toast） */
const exportError = ref('')

/** 各格式的说明文案键 */
const HINT_KEYS: Record<ExportFmt, string> = {
  html: 'export.hintHtml',
  pdf: 'export.hintPdf',
  png: 'export.hintPng',
  latex: 'export.hintLaTeX'
}

const MARGINS: { key: 'normal' | 'narrow' | 'none'; labelKey: string }[] = [
  { key: 'normal', labelKey: 'export.mNormal' },
  { key: 'narrow', labelKey: 'export.mNarrow' },
  { key: 'none', labelKey: 'export.mNone' }
]

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function close(): void {
  if (busy.value) return
  ui.exportOpen = false
}

function onKeydown(e: KeyboardEvent): void {
  if (!ui.exportOpen) return
  if (e.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearPdfHost()
})

function clearPdfHost(): void {
  if (pdfHost.value) pdfHost.value.innerHTML = ''
  pdfPageHint.value = ''
}

/* ---------- 预览生成（防抖 + 序号防竞态） ---------- */
let genTimer: number | undefined
let genSeq = 0

function schedulePreview(): void {
  window.clearTimeout(genTimer)
  genTimer = window.setTimeout(() => void regenerate(), 600)
}

watch([fmt, margin, landscape, pageNumbers], schedulePreview)

/** 对话框每次打开：重置文件名与预览 */
watch(
  () => ui.exportOpen,
  (open) => {
    if (!open) return
    const tab = docs.active
    fileName.value = tab && !tab.isHome ? baseName(tab.name) : ''
    previewHtml.value = ''
    clearPdfHost()
    previewFailed.value = false
    exportError.value = ''
    // 格式跟随当前标签的记忆；没导出过的标签用默认（列表第一个）
    fmt.value = (tab && fmtByTab.get(tab.id)) || FMT_DEFAULT
    window.clearTimeout(genTimer)
    genTimer = window.setTimeout(() => void regenerate(), 150)
  }
)

/* 用户切换格式：记到当前标签名下（关标签时由下面的剪枝清除） */
watch(fmt, (f) => {
  exportError.value = ''
  const tab = docs.active
  if (tab && !tab.isHome) fmtByTab.set(tab.id, f)
})

/* 标签关闭 → 清掉它的格式记忆 */
watch(
  () => docs.tabs.map((t) => t.id),
  (ids) => {
    const alive = new Set(ids)
    for (const key of [...fmtByTab.keys()]) {
      if (!alive.has(key)) fmtByTab.delete(key)
    }
  }
)

function activePreviewHtml(): string | null {
  const preview = document.querySelector('.md-preview')
  if (!preview || !preview.innerHTML.trim()) return null
  return preview.innerHTML
}

/* pdf.js 模块懒加载（约 400KB，导出对话框才用到） */
type PdfjsModule = typeof import('pdfjs-dist')
let pdfjsMod: PdfjsModule | null = null

async function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsMod ??= await import('pdfjs-dist')
  pdfjsMod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  return pdfjsMod
}

/** 把 base64 PDF 渲染成 A4 页面卡片（canvas），宽自适应预览区 */
async function renderPdfPreview(b64: string, seq: number): Promise<void> {
  const host = pdfHost.value
  if (!host) return
  const pdfjs = await loadPdfjs()
  if (seq !== genSeq) return
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  if (seq !== genSeq) return
  host.innerHTML = ''
  const total = doc.numPages
  const count = Math.min(total, PREVIEW_MAX_PAGES)
  const width = Math.max(320, host.clientWidth - 56)
  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i)
    const scale = width / page.getViewport({ scale: 1 }).width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.className = 'pdf-page'
    host.appendChild(canvas)
    await page.render({ canvas, viewport }).promise
    if (seq !== genSeq) {
      host.innerHTML = ''
      return
    }
  }
  pdfPageHint.value = total > count ? t('export.pagesHint', { n: count, total }) : ''
}

async function regenerate(): Promise<void> {
  const tab = docs.active
  if (!tab || tab.isHome || !ui.exportOpen) return
  // LaTeX：不需要预览 DOM，直接转 markdown 源码
  if (fmt.value === 'latex') {
    const seq = ++genSeq
    generating.value = true
    clearPdfHost()
    previewHtml.value = ''
    texPreview.value = mdToLaTeX(tab.content)
    previewFailed.value = false
    if (seq === genSeq) generating.value = false
    return
  }
  const body = activePreviewHtml()
  if (body === null) {
    previewFailed.value = true
    return
  }
  const seq = ++genSeq
  generating.value = true
  try {
    const html = await buildExportHtml(tab.name, body, { forPrint: fmt.value === 'pdf', theme: ui.effectiveTheme })
    if (seq !== genSeq) return
    if (fmt.value === 'pdf') {
      const b64 = await window.api.export.previewPdf(html, {
        margin: margin.value,
        landscape: landscape.value,
        pageNumbers: pageNumbers.value
      })
      if (seq !== genSeq) return
      previewHtml.value = ''
      previewFailed.value = false
      await renderPdfPreview(b64, seq)
    } else {
      // HTML / PNG 预览直接展示 HTML 版式（PNG 截取的正是这份排版）
      clearPdfHost()
      previewHtml.value = html
      previewFailed.value = false
    }
  } catch (err) {
    if (seq === genSeq) {
      clearPdfHost()
      previewFailed.value = true
      // 预览失败的真实原因也展示出来（否则只剩一句"没有可预览的内容"无从排查）
      exportError.value = err instanceof Error ? err.message : String(err)
    }
    console.error('[export] preview failed:', err)
  } finally {
    if (seq === genSeq) generating.value = false
  }
}

/* ---------- 导出 ---------- */
async function doExport(): Promise<void> {
  const tab = docs.active
  if (!tab || tab.isHome) return
  const name = fileName.value.trim()
  if (!name) {
    ui.showToast(t('export.nameRequired'))
    return
  }
  // LaTeX 直接转 markdown 源码：不依赖预览 DOM（单栏/即显模式也能导出）
  if (fmt.value === 'latex') {
    busy.value = true
    try {
      const tex = mdToLaTeX(tab.content)
      const path = await window.api.dialog.saveFile(`${name}.tex`, 'tex')
      if (!path) return
      await window.api.fs.writeFile(path, tex)
      ui.showToast(t('export.savedLaTeX', { name: path.split(/[\\/]/).pop() }))
      ui.exportOpen = false
    } catch (err) {
      exportError.value = err instanceof Error ? err.message : String(err)
    } finally {
      busy.value = false
    }
    return
  }
  const body = activePreviewHtml()
  if (body === null) {
    ui.showToast(t('export.emptyDoc'))
    return
  }
  busy.value = true
  try {
    const html = await buildExportHtml(tab.name, body, { forPrint: fmt.value === 'pdf', theme: ui.effectiveTheme })
    if (fmt.value === 'html') {
      const path = await window.api.dialog.saveFile(`${name}.html`, 'html')
      if (!path) return
      await window.api.fs.writeFile(path, html)
      ui.showToast(t('export.savedHtml', { name: path.split(/[\\/]/).pop() }))
    } else if (fmt.value === 'pdf') {
      const saved = await window.api.export.pdf(
        html,
        { margin: margin.value, landscape: landscape.value, pageNumbers: pageNumbers.value },
        `${name}.pdf`
      )
      if (!saved) return
      ui.showToast(t('export.savedPdf', { name: saved.split(/[\\/]/).pop() }))
    } else {
      const saved = await window.api.export.png(html, `${name}.png`)
      if (!saved) return
      ui.showToast(
        saved.truncated
          ? t('export.pngTruncated')
          : t('export.savedPng', { name: saved.path.split(/[\\/]/).pop() })
      )
    }
    ui.exportOpen = false
  } catch (err) {
    console.error('[export] failed:', err)
    // 弹窗内醒目展示真实原因（此前仅 Toast，还被遮罩盖住）；不再自动关闭弹窗
    exportError.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="export-dialog">
      <div v-if="ui.exportOpen" class="mask" @click.self="close">
        <section class="dialog" role="dialog" :aria-label="$t('export.title')">
          <!-- 左列：设置 -->
          <div class="settings">
            <h2 class="title">{{ $t('export.title') }}</h2>
            <p class="doc-name" :title="docs.active?.name">{{ docs.active?.name }}</p>

            <label class="field">
              <span class="label">{{ $t('export.fileName') }}</span>
              <input v-model="fileName" class="text-input" spellcheck="false" />
            </label>

            <div class="field">
              <span class="label">{{ $t('export.format') }}</span>
              <div class="seg">
                <button :class="{ on: fmt === 'png' }" @click="fmt = 'png'">PNG</button>
                <button :class="{ on: fmt === 'pdf' }" @click="fmt = 'pdf'">PDF</button>
                <button :class="{ on: fmt === 'html' }" @click="fmt = 'html'">HTML</button>
                <button :class="{ on: fmt === 'latex' }" @click="fmt = 'latex'">LaTeX</button>
              </div>
            </div>

            <template v-if="fmt === 'pdf'">
              <div class="field">
                <span class="label">{{ $t('export.margin') }}</span>
                <div class="seg">
                  <button
                    v-for="m in MARGINS"
                    :key="m.key"
                    :class="{ on: margin === m.key }"
                    @click="margin = m.key"
                  >
                    {{ $t(m.labelKey) }}
                  </button>
                </div>
              </div>
              <div class="field">
                <span class="label">{{ $t('export.orient') }}</span>
                <div class="seg">
                  <button :class="{ on: !landscape }" @click="landscape = false">{{ $t('export.portrait') }}</button>
                  <button :class="{ on: landscape }" @click="landscape = true">{{ $t('export.landscape') }}</button>
                </div>
              </div>
              <div class="field">
                <span class="label">{{ $t('export.pageNumbers') }}</span>
                <div class="seg">
                  <button :class="{ on: !pageNumbers }" @click="pageNumbers = false">{{ $t('common.off') }}</button>
                  <button :class="{ on: pageNumbers }" @click="pageNumbers = true">{{ $t('common.on') }}</button>
                </div>
              </div>
            </template>

            <p class="hint">{{ $t(HINT_KEYS[fmt]) }}</p>

            <p v-if="exportError" class="error-banner" role="alert">
              {{ $t('export.errorPrefix') }}：{{ exportError }}
            </p>

            <div class="actions">
              <button class="btn cancel" :disabled="busy" @click="close">{{ $t('common.cancel') }}</button>
              <button class="btn ok" :disabled="busy" @click="doExport">
                {{ busy ? $t('export.doing') : $t('export.do') }}
              </button>
            </div>
          </div>

          <!-- 右列：实际产物预览 -->
          <div class="preview">
            <div v-if="generating" class="preview-mask"><span>{{ $t('export.generating') }}</span></div>
            <div v-if="previewFailed" class="preview-mask">
              <span>{{ fmt === 'pdf' ? $t('export.previewFailed') : $t('export.nothingToPreview') }}</span>
            </div>
            <iframe
              v-if="fmt !== 'pdf' && previewHtml"
              class="preview-frame"
              :srcdoc="previewHtml"
              sandbox=""
              :title="$t('export.title')"
            />
            <div v-else-if="fmt === 'pdf'" ref="pdfHost" class="pdf-host">
              <p v-if="pdfPageHint" class="pdf-hint">{{ pdfPageHint }}</p>
            </div>
            <pre v-else-if="fmt === 'latex'" class="tex-view">{{ texPreview }}</pre>
            <div v-else-if="!generating && !previewFailed" class="preview-empty">{{ $t('export.preparing') }}</div>
          </div>
        </section>
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
  width: min(980px, calc(100vw - 72px));
  height: min(660px, calc(100vh - 96px));
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-pop);
  display: flex;
  overflow: hidden;
}

/* ---------- 左列 ---------- */
.settings {
  width: 252px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
  padding: 20px 18px 16px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.title {
  font-size: 14.5px;
  font-weight: 700;
  margin-bottom: 4px;
}

.doc-name {
  font-size: 11.5px;
  color: var(--text-2);
  margin-bottom: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.label {
  font-size: 11.5px;
  color: var(--text-2);
}

.text-input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
  width: 100%;
}

.text-input:focus {
  outline: none;
  border-color: var(--accent);
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.seg button {
  flex: 1;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}

.seg button.on {
  background: var(--surface);
  color: var(--accent-strong);
  font-weight: 600;
}

.hint {
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.7;
  background: var(--surface);
  border-radius: var(--radius-s);
  padding: 8px 10px;
  margin-top: auto;
}

/* 导出失败：醒目错误条（Toast 会被遮罩盖住且一闪而过，这里常驻到下次尝试） */
.error-banner {
  margin-top: 12px;
  padding: 9px 11px;
  border-radius: var(--radius-s);
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
  font-size: 11.5px;
  line-height: 1.6;
  word-break: break-all;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.btn {
  flex: 1 1 auto;
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
  border-radius: var(--radius-s);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.cancel {
  border: 1px solid var(--border);
  color: var(--text-2);
  background: transparent;
}

.cancel:hover:not(:disabled) {
  border-color: var(--text-2);
  color: var(--text);
}

.ok {
  background: var(--accent);
  color: #fff;
  flex-grow: 1.4;
}

.ok:hover:not(:disabled) {
  background: var(--accent-strong);
}

/* ---------- 右列：预览 ---------- */
.preview {
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--bg);
  display: flex;
}

.preview-frame {
  flex: 1;
  border: none;
  background: var(--bg);
}

/* PDF 预览：A4 页面卡片纵向排布 */
.pdf-host {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.pdf-host .pdf-page {
  background: #fff;
  border-radius: 2px;
  box-shadow: 0 2px 14px rgba(20, 16, 12, 0.28);
  flex-shrink: 0;
}

/* LaTeX 预览：等宽源码全文 */
.tex-view {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: auto;
  padding: 20px 24px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.pdf-hint {
  font-size: 11px;
  color: var(--text-2);
  letter-spacing: 0.5px;
}

.preview-mask {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  display: grid;
  place-items: center;
  font-size: 12.5px;
  color: var(--text-2);
}

.preview-empty {
  flex: 1;
  display: grid;
  place-items: center;
  font-size: 12.5px;
  color: var(--text-2);
}

.export-dialog-enter-active,
.export-dialog-leave-active {
  transition: opacity 0.14s ease;
}

.export-dialog-enter-active .dialog,
.export-dialog-leave-active .dialog {
  transition: transform 0.14s ease;
}

.export-dialog-enter-from,
.export-dialog-leave-to {
  opacity: 0;
}

.export-dialog-enter-from .dialog,
.export-dialog-leave-to .dialog {
  transform: translateY(6px) scale(0.97);
}
</style>
