<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDocumentsStore } from '@/stores/documents'
import { t } from '@/i18n'

/**
 * Quick Open 快速打开（ROADMAP 2.1）：Ctrl+P 呼出，模糊搜索工作区文件名并打开。
 * 数据源复用 workspace 树的 allFiles（懒加载列表，打开工作区时已就绪）；
 * 打开动作走 documents.openPath（含跨窗口去重/最近文件记录等既有链路）。
 */

const ui = useUiStore()
const ws = useWorkspaceStore()
const docs = useDocumentsStore()

const query = ref('')
const active = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

/* 键盘导航时保持激活项可见 */
watch(active, async () => {
  await nextTick()
  listEl.value
    ?.querySelector('[data-qo-index="' + active.value + '"]')
    ?.scrollIntoView({ block: 'nearest' })
})

/** 文件名（最后一段，/ 与 \ 都认） */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/** 相对工作区根的展示路径（同名字段提示用） */
function relPath(p: string): string {
  if (!ws.root) return p
  const root = ws.root.replace(/[\\/]+$/, '')
  const norm = p.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/'
  return norm.startsWith(r) ? norm.slice(r.length) : p
}

/** 子序列匹配：pattern 按序出现在 target 中则返回[得分, 首个命中位置]，否则 null。
 *  连续命中加分、词首（/ _ - . 后或首个）加分，鼓励"文件名前缀"式输入 */
function fuzzyMatch(pattern: string, target: string): [number, number] | null {
  if (!pattern) return [0, 0]
  const ti = target.toLowerCase()
  const pi = pattern.toLowerCase()
  const direct = ti.indexOf(pi)
  if (direct >= 0) return [100 - Math.min(direct, 50) + (direct === 0 ? 20 : 0), direct]
  let from = 0
  let score = 0
  let first = -1
  let prevHit = -2
  for (let pIdx = 0; pIdx < pi.length; pIdx++) {
    const found = ti.indexOf(pi[pIdx], from)
    if (found < 0) return null
    if (first < 0) first = found
    if (found === prevHit + 1) score += 3
    const prevCh = found > 0 ? ti[found - 1] : ''
    if (found === 0 || '/_- .'.includes(prevCh)) score += 2
    score -= Math.min(found - prevHit - 2, 4)
    prevHit = found
    from = found + 1
  }
  return [score, first]
}

interface Hit {
  path: string
  name: string
  rel: string
  score: number
}

const hits = computed<Hit[]>(() => {
  const q = query.value.trim()
  const all = ws.allFiles
  if (!q) {
    // 空查询：按最近文件时间序（allFiles 本身是树序），直接给前 50
    return all.slice(0, 50).map((p) => ({ path: p, name: baseName(p), rel: relPath(p), score: 0 }))
  }
  const scored: Hit[] = []
  for (const p of all) {
    const name = baseName(p)
    const m1 = fuzzyMatch(q, name)
    const m2 = fuzzyMatch(q, relPath(p))
    const s = Math.max(m1 ? m1[0] : -1e9, m2 ? m2[0] - 30 : -1e9)
    if (s > -1e8) scored.push({ path: p, name, rel: relPath(p), score: s })
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return scored.slice(0, 50)
})

/* 查询/候选变化：激活项回到首位 */
watch([query, hits], () => {
  active.value = 0
})

watch(
  () => ui.quickOpenOpen,
  async (open) => {
    if (!open) return
    query.value = ''
    active.value = 0
    await nextTick()
    inputEl.value?.focus()
  }
)

function move(delta: number): void {
  const n = hits.value.length
  if (n === 0) return
  active.value = (active.value + delta + n) % n
}

function openHit(hit?: Hit): void {
  const target = hit ?? hits.value[active.value]
  if (!target) return
  ui.quickOpenOpen = false
  void docs.openPath(target.path)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    ui.quickOpenOpen = false
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    openHit()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.quickOpenOpen" class="qo-mask" @mousedown.self="ui.quickOpenOpen = false">
      <div class="qo-panel" role="dialog" :aria-label="$t('qo.title')">
        <input
          ref="inputEl"
          v-model="query"
          class="qo-input"
          type="text"
          :placeholder="$t('qo.placeholder')"
          spellcheck="false"
          @keydown="onKeydown"
        />
        <div v-if="!ws.root" class="qo-hint">{{ $t('qo.noWorkspace') }}</div>
        <div v-else-if="hits.length === 0" class="qo-hint">{{ $t('qo.noMatch') }}</div>
        <ul v-else class="qo-list" ref="listEl">
          <li
            v-for="(hit, i) in hits"
            :key="hit.path"
            class="qo-item"
            :class="{ active: i === active }"
            :data-qo-index="i"
            @mouseenter="active = i"
            @mousedown.prevent="openHit(hit)"
          >
            <span class="qo-name">{{ hit.name }}</span>
            <span class="qo-dir">{{ hit.rel.slice(0, -hit.name.length) || './' }}</span>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* Teleport 到 body，全局样式；跟随应用 CSS 变量（双主题） */
.qo-mask {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.qo-panel {
  width: min(560px, calc(100vw - 48px));
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.qo-input {
  height: 42px;
  padding: 0 14px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 14px;
  outline: none;
}

.qo-hint {
  padding: 18px 14px;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: center;
}

.qo-list {
  max-height: 46vh;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.qo-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-s);
  cursor: pointer;
  min-width: 0;
}

.qo-item.active {
  background: var(--accent-soft);
}

.qo-name {
  color: var(--text);
  font-size: 13px;
  flex-shrink: 0;
}

.qo-item.active .qo-name {
  color: var(--accent-strong);
}

.qo-dir {
  color: var(--text-2);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl; /* 长路径截头留尾：目录前缀从左侧省略 */
  text-align: left;
  min-width: 0;
  flex: 1;
}
</style>
