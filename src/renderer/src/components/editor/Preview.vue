<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ensureMath, renderWithDir } from '@/services/markdown'
import { useUiStore } from '@/stores/ui'
import '@/assets/preview.css'

const props = defineProps<{ content: string; docDir: string | null }>()
const emit = defineEmits<{ (e: 'scroll-sync', line: number, frac: number): void }>()

const ui = useUiStore()
const scroller = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const html = ref('')

interface Block {
  /** 块首行（1 基） */
  line: number
  /** 块末行（1 基，含） */
  end: number
  top: number
  height: number
}

let blocks: Block[] = []
let lockUntil = 0
let renderTimer: number | undefined
let renderSeq = 0

watch(
  () => props.content,
  (content) => {
    window.clearTimeout(renderTimer)
    renderTimer = window.setTimeout(() => void render(content), 120)
  },
  { immediate: true }
)

/** 换文档（docDir 变化）时立即重渲染，图片相对路径才能正确解析 */
watch(
  () => props.docDir,
  () => void render(props.content)
)

/** 主题切换 → 清缓存重渲染图表（mermaid 主题不同） */
watch(
  () => ui.effectiveTheme,
  () => {
    mermaidCache.clear()
    void render(props.content)
  }
)

async function render(content: string): Promise<void> {
  const seq = ++renderSeq
  await ensureMath(content)
  if (seq !== renderSeq) return
  html.value = content.trim() ? renderWithDir(content, props.docDir) : ''
  await nextTick()
  collectBlocks()
  await renderMermaid()
}

/* ---------- mermaid 异步渲染（带缓存） ---------- */

import type { Mermaid as MermaidInstance } from 'mermaid'
let mermaidMod: MermaidInstance | null = null
let mermaidLoading: Promise<MermaidInstance> | null = null
const mermaidCache = new Map<string, string>()

function loadMermaid(): Promise<MermaidInstance> {
  mermaidLoading ??= import('mermaid').then((m): MermaidInstance => {
    const inst = m.default
    inst.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: ui.effectiveTheme === 'dark' ? 'dark' : 'default',
      fontFamily: 'var(--font-ui)'
    })
    mermaidMod = inst
    return inst
  })
  return mermaidLoading
}

async function renderMermaid(): Promise<void> {
  const nodes = body.value?.querySelectorAll<HTMLElement>('.mermaid')
  if (!nodes || nodes.length === 0) return
  let m: MermaidInstance
  try {
    m = await loadMermaid()
  } catch (err) {
    console.error('[preview] mermaid load failed:', err)
    return
  }
  for (const node of [...nodes]) {
    if (!node.isConnected) return
    const code = node.textContent ?? ''
    const key = `${ui.effectiveTheme}|${code}`
    const hit = mermaidCache.get(key)
    if (hit !== undefined) {
      node.innerHTML = hit
      continue
    }
    try {
      node.removeAttribute('data-processed')
      await m.run({ nodes: [node] })
      mermaidCache.set(key, node.innerHTML)
    } catch (err) {
      console.error('[preview] mermaid render failed:', err)
      node.classList.add('mermaid-error')
      node.setAttribute('data-mermaid-src', code)
      node.textContent = code
    }
  }
  collectBlocks() // svg 高度与占位文本不同，重收集块映射
}

/* ---------- 同步滚动 ---------- */

function collectBlocks(): void {
  if (!body.value) return
  blocks = [...body.value.querySelectorAll<HTMLElement>('[data-source-line]')].map((el) => ({
    line: Number(el.dataset.sourceLine) + 1,
    end: Math.max(Number(el.dataset.sourceLine) + 1, Number(el.dataset.sourceLineEnd)),
    top: el.offsetTop,
    height: el.offsetHeight
  }))
}

/** 视口顶所在块（top 为块的容器内容坐标） */
function blockAtScrollTop(st: number): { i: number; f: number } {
  let i = 0
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].top <= st + 6) i = k
    else break
  }
  const cur = blocks[i]
  const next = blocks[i + 1]
  const span = next ? next.top - cur.top : Math.max(1, cur.height)
  const f = Math.min(1, Math.max(0, (st + 6 - cur.top) / span))
  return { i, f }
}

/* 预览滚动 → 通知编辑器：块内按行跨度插值出行号 */
function onScrollDom(): void {
  if (Date.now() < lockUntil) return
  const el = scroller.value
  if (!el || blocks.length === 0) return
  const { i, f } = blockAtScrollTop(el.scrollTop)
  const cur = blocks[i]
  const next = blocks[i + 1]
  const lineSpan = next ? next.line - cur.line : Math.max(1, cur.end - cur.line)
  emit('scroll-sync', cur.line + f * lineSpan, 0)
}

/* 编辑器滚动 → 同步预览：目标行落在哪个块内，块内按高度比例插值 */
function syncToLine(line: number, _frac: number): void {
  const el = scroller.value
  if (!el || blocks.length === 0) return
  let i = 0
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].line <= line) i = k
    else break
  }
  const cur = blocks[i]
  const next = blocks[i + 1]
  const lineSpan = next ? next.line - cur.line : Math.max(1, cur.end - cur.line)
  const f = Math.min(1, Math.max(0, (line - cur.line) / lineSpan))
  const topSpan = next ? next.top - cur.top : Math.max(1, cur.height)
  lockUntil = Date.now() + 120
  el.scrollTop = Math.max(0, cur.top + f * topSpan - 6)
}

defineExpose({ syncToLine })

/* ---------- 图片点击 → 查看器 ---------- */

function onClickDom(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG' && target.parentElement?.closest('.md-preview')) {
    e.preventDefault()
    ui.viewerImage = (target as HTMLImageElement).src
  }
}

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  scroller.value?.addEventListener('scroll', onScrollDom, { passive: true })
  scroller.value?.addEventListener('click', onClickDom)
  // 字体加载/窗口缩放/图表渲染后块位置会变，重收集保持映射准确
  resizeObserver = new ResizeObserver(() => collectBlocks())
  if (scroller.value) resizeObserver.observe(scroller.value)
  if (body.value) resizeObserver.observe(body.value)
})

onBeforeUnmount(() => {
  scroller.value?.removeEventListener('scroll', onScrollDom)
  scroller.value?.removeEventListener('click', onClickDom)
  resizeObserver?.disconnect()
  window.clearTimeout(renderTimer)
})
</script>

<template>
  <div ref="scroller" class="preview-scroll">
    <div v-if="html" ref="body" class="md-preview" v-html="html" />
    <div v-else class="preview-empty">{{ $t('preview.empty') }}</div>
  </div>
</template>

<style scoped>
.preview-scroll {
  height: 100%;
  overflow-y: auto;
  position: relative; /* 作为 offsetTop 参照 */
}

.preview-empty {
  padding: 32px 20px;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: center;
}
</style>
