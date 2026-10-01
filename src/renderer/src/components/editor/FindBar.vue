<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import type { FindQuery } from '@/find-shared'

/**
 * 三种模式（即显/源码/预览）共用的停靠查找条。
 * 纯展示组件：查询状态由父组件持有，操作经事件上抛；
 * 搜索定位/替换的具体驱动在各自父组件（PM 插件 / CM6 命令 / DOM 高亮）。
 */
const props = defineProps<{
  query: FindQuery
  /** 只搜索模式（预览）不传 */
  replace?: string
  count: number
  /** 0 基活动命中；-1 = 无 */
  active: number
  error: boolean
  /** 只搜索（预览模式）：隐藏替换区 */
  searchOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:query', q: FindQuery): void
  (e: 'update:replace', v: string): void
  (e: 'nav', dir: 1 | -1): void
  (e: 'replace'): void
  (e: 'replace-all'): void
  (e: 'close'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)

const countLabel = computed(() => {
  if (props.error) return t('find.badPattern')
  if (!props.query.text) return '0/0'
  if (!props.count) return t('find.noMatch')
  return `${props.active + 1}/${props.count}`
})

function patch(p: Partial<FindQuery>): void {
  emit('update:query', { ...props.query, ...p })
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('nav', e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation() // 已在输入层处理，别再冒泡到条根节点二次 close
    emit('close')
  }
}

function onReplaceKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    emit('replace')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

/** 条内任意位置（含按钮焦点）按 Esc 关闭；输入框的 Esc 已 stopPropagation 不会重复触发 */
function onBarKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

defineExpose({
  focusInput: () => {
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})
</script>

<template>
  <!-- Esc 在条根节点接管：焦点在按钮上（点过 ↑↓ 之后）也能关闭 -->
  <div class="find-bar" @keydown="onBarKeydown">
    <input
      ref="inputRef"
      :value="query.text"
      class="find-input"
      :class="{ 'find-input-err': error }"
      :placeholder="$t('find.search')"
      spellcheck="false"
      @input="patch({ text: ($event.target as HTMLInputElement).value })"
      @keydown="onSearchKeydown"
    />
    <button class="find-btn" :title="$t('find.prev')" @click="emit('nav', -1)">↑</button>
    <button class="find-btn" :title="$t('find.next')" @click="emit('nav', 1)">↓</button>
    <span class="find-count" :class="{ 'find-count-err': error }">{{ countLabel }}</span>
    <button
      class="find-tg"
      :class="{ on: query.caseSensitive && !query.regexp }"
      :disabled="query.regexp"
      :title="query.regexp ? $t('find.tgDisabled') : $t('find.case')"
      @click="patch({ caseSensitive: !query.caseSensitive })"
    >
      Aa
    </button>
    <button
      class="find-tg"
      :class="{ on: query.regexp }"
      :title="$t('find.regex')"
      @click="patch({ regexp: !query.regexp })"
    >
      .*
    </button>
    <button
      class="find-tg"
      :class="{ on: query.wholeWord && !query.regexp }"
      :disabled="query.regexp"
      :title="query.regexp ? $t('find.tgDisabled') : $t('find.wholeWord')"
      @click="patch({ wholeWord: !query.wholeWord })"
    >
      \b
    </button>
    <template v-if="!searchOnly">
      <span class="find-sep" />
      <input
        :value="replace"
        class="find-input find-input-repl"
        :placeholder="$t('find.replaceWith')"
        spellcheck="false"
        @input="emit('update:replace', ($event.target as HTMLInputElement).value)"
        @keydown="onReplaceKeydown"
      />
      <button class="find-btn find-btn-txt" :title="$t('find.replace')" @click="emit('replace')">
        {{ $t('find.replace') }}
      </button>
      <button class="find-btn find-btn-txt" :title="$t('find.replaceAll')" @click="emit('replace-all')">
        {{ $t('find.replaceAll') }}
      </button>
    </template>
    <button class="find-btn" :title="$t('find.close')" @click="emit('close')">✕</button>
  </div>
</template>

<style scoped>
/* 停靠在面板顶部：压缩正文可用高度，不遮挡内容 */
.find-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 10px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.find-input {
  flex: 1 1 120px;
  min-width: 88px;
  max-width: 260px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  outline: none;
}

.find-input:focus {
  border-color: var(--accent);
}

.find-input-err {
  border-color: var(--danger);
  color: var(--danger);
}

.find-input-repl {
  flex: 0 1 150px;
}

.find-btn {
  padding: 3px 7px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
}

.find-btn:hover {
  background: var(--accent-soft);
  color: var(--text);
}

.find-btn-txt {
  border-color: var(--border);
  background: var(--surface);
}

.find-tg {
  padding: 3px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
}

.find-tg:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.find-tg.on {
  color: var(--accent-strong);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.find-count {
  font-size: 11px;
  color: var(--text-2);
  min-width: 40px;
  text-align: center;
  white-space: nowrap;
}

.find-count-err {
  color: var(--danger);
}

.find-sep {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 2px;
}
</style>
