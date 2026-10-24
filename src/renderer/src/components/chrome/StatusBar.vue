<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'
import { textStats } from '@/utils/text'
import { t } from '@/i18n'
import { shortcutTitle } from '@/services/shortcut-title'
import type { ThemeInfo } from '@shared/types'

const ui = useUiStore()
const docs = useDocumentsStore()

const stats = computed(() => textStats(docs.active?.content ?? ''))

const docOpen = computed(() => !!docs.active && !docs.active.isHome)

/** 保存状态：未保存 / 已保存 HH:mm:ss（实时反映，替代易过期的文本提示） */
const saveLabel = computed(() => {
  if (!docOpen.value || ui.saveState === 'clean') return ''
  if (ui.saveState === 'dirty') return t('status.unsaved')
  const time = new Date(ui.savedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return t('status.savedAt', {
    time: `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`
  })
})

/** 当前主题样式徽标：名字 + 生效变体（auto 跟随明暗实时显示，截图排查用） */
const themeBadge = computed(() => {
  const name = ui.appearance.themeCss
  if (!name) return t('settings.themeDefault')
  const variant = ui.appearance.themeVariant
  const vLabel =
    variant && variant !== 'auto'
      ? variant === 'dark'
        ? t('settings.thDark')
        : variant === 'light'
          ? t('settings.thLight')
          : variant === 'grey'
            ? t('settings.variantGrey')
            : variant
      : ui.effectiveTheme === 'dark'
        ? t('settings.thDark')
        : t('settings.thLight')
  return `${name} · ${vLabel}`
})

/* ---------- 主题快捷切换弹层（含内置默认，免进设置） ---------- */

const themeMenuOpen = ref(false)
const themeList = ref<ThemeInfo[]>([])

interface MenuFamily {
  key: string
  /** 三变体以上（配色族/浅深灰）：行内展开圆点切换；单色/浅深双色整行点击 */
  dots: boolean
  swatches: { key: string; label: string; color: string }[]
}

const variantLabel = (key: string): string => {
  if (key === 'light') return t('settings.thLight')
  if (key === 'dark') return t('settings.thDark')
  if (key === 'grey') return t('settings.variantGrey')
  return key
}

const themeMenuFamilies = computed<MenuFamily[]>(() => {
  const map = new Map<string, ThemeInfo[]>()
  for (const x of themeList.value) {
    const arr = map.get(x.family)
    if (arr) arr.push(x)
    else map.set(x.family, [x])
  }
  const order = (k: string): number => {
    const vi = ['light', 'dark', 'grey']
    return vi.indexOf(k) + 1 || 99
  }
  return [...map.values()].map((files) => {
    const dots = files.length >= 3
    const fallback = (x: ThemeInfo): string =>
      x.color || (x.variant === 'dark' ? '#3b3b3b' : x.variant === 'light' ? '#f2efe9' : '#9a9a92')
    return {
      key: files[0].family,
      dots,
      swatches: dots
        ? [...files]
            .sort((a, b) => order(a.variantKey) - order(b.variantKey) || a.variantKey.localeCompare(b.variantKey))
            .map((f) => ({ key: f.variantKey, label: variantLabel(f.variantKey), color: fallback(f) }))
        : []
    }
  })
})

async function toggleThemeMenu(): Promise<void> {
  themeMenuOpen.value = !themeMenuOpen.value
  if (themeMenuOpen.value) themeList.value = await window.api.theme.list()
}

function applyTheme(key: string): void {
  const fam = key ? themeList.value.filter((x) => x.family === key) : []
  const hasPair = fam.some((x) => x.variant === 'light') && fam.some((x) => x.variant === 'dark')
  // 有浅/深成对跟随明暗；单变体/配色族先取 auto，具体颜色点色板再钉
  const variant = key && !hasPair && !fam.some((x) => x.colorFamily) ? (fam[0]?.variantKey ?? 'auto') : 'auto'
  void ui.setAppearance({ themeCss: key, themeVariant: variant })
}

function applyFamilyVariant(key: string, variant: string): void {
  if (ui.appearance.themeCss !== key) void ui.setAppearance({ themeCss: key, themeVariant: variant })
  else void ui.setAppearance({ themeVariant: variant })
}

function openThemeSettings(): void {
  themeMenuOpen.value = false
  ui.settingsOpen = true
}

onBeforeUnmount(() => {
  themeMenuOpen.value = false
})
</script>

<template>
  <footer class="statusbar">
    <div class="left">
      <span v-if="ui.vimMode" class="vim-chip" :class="{ ins: ui.vimInsert }" :title="$t('status.vimTitle')">
        {{ ui.vimInsert ? 'INSERT' : 'NORMAL' }}
      </span>
      <span v-if="saveLabel" class="save-state" :class="{ dirty: ui.saveState === 'dirty' }">
        <i class="pip" />{{ saveLabel }}
      </span>
      <template v-if="docOpen">
        <span class="sep">·</span>
        <span :title="t('status.lineTitle', { n: ui.currentLine })">{{ t('status.words', { n: stats.words.toLocaleString() }) }}</span>
        <span class="sep">·</span>
        <span>{{ t('status.chars', { n: stats.chars.toLocaleString() }) }}</span>
        <span class="sep">·</span>
        <span>{{ stats.minutes ? t('status.readMin', { n: stats.minutes }) : '—' }}</span>
      </template>
    </div>
    <div class="right">
      <div class="theme-anchor">
        <button
          class="badge toggle theme-badge"
          :class="{ on: themeMenuOpen }"
          :title="$t('status.themeTitle', { name: ui.appearance.themeCss || $t('settings.themeDefault') })"
          @click="toggleThemeMenu"
        >
          <i class="pip accent" />{{ themeBadge }}
        </button>
        <!-- 快捷切换：内置默认 + 全部主题族（配色族内联色板） -->
        <div v-if="themeMenuOpen" class="theme-menu">
          <button class="tm-row" :class="{ on: !ui.appearance.themeCss }" @click="applyTheme('')">
            {{ $t('settings.themeDefault') }}
          </button>
          <template v-for="f in themeMenuFamilies" :key="f.key">
            <div class="tm-row tm-family" :class="{ on: ui.appearance.themeCss === f.key && !f.dots }">
              <button class="tm-name" :title="f.key" @click="applyTheme(f.key)">{{ f.key }}</button>
              <span v-if="f.dots" class="tm-swatches">
                <button
                  v-if="f.swatches.some((s) => s.key === 'light') && f.swatches.some((s) => s.key === 'dark')"
                  class="tm-auto"
                  :class="{ on: ui.appearance.themeCss === f.key && (ui.appearance.themeVariant || 'auto') === 'auto' }"
                  @click.stop="applyFamilyVariant(f.key, 'auto')"
                >
                  {{ $t('settings.variantAuto') }}
                </button>
                <button
                  v-for="s in f.swatches"
                  :key="s.key"
                  class="tm-swatch"
                  :class="{ on: ui.appearance.themeCss === f.key && (ui.appearance.themeVariant || 'auto') === s.key }"
                  :title="s.label"
                  :style="{ background: s.color }"
                  @click.stop="applyFamilyVariant(f.key, s.key)"
                />
              </span>
            </div>
          </template>
          <button class="tm-row tm-more" @click="openThemeSettings">{{ $t('status.themeMore') }}</button>
        </div>
      </div>
      <div v-if="themeMenuOpen" class="menu-backdrop" @click="themeMenuOpen = false" />
      <button
        class="badge toggle"
        :class="{ on: ui.focusMode }"
        :title="shortcutTitle('view:toggleFocus', $t('status.focusTitle'))"
        @click="ui.toggleFocus()"
      >
        {{ $t('status.focus') }}
      </button>
      <button
        class="badge toggle"
        :class="{ on: ui.typewriterMode }"
        :title="shortcutTitle('view:toggleTypewriter', $t('status.typewriterTitle'))"
        @click="ui.toggleTypewriter()"
      >
        {{ $t('status.typewriter') }}
      </button>
      <!-- 写作辅助开关（4.2/4.3）：常显徽标，点击直接切换 -->
      <button
        class="badge toggle"
        :class="{ on: ui.editorPrefs.typographer }"
        :title="$t('status.typographerTitle')"
        @click="ui.setEditorPrefs({ typographer: !ui.editorPrefs.typographer })"
      >
        {{ $t('settings.typographer') }}
      </button>
      <button
        class="badge toggle"
        :class="{ on: ui.editorPrefs.spellcheck }"
        :title="$t('status.spellcheckTitle')"
        @click="ui.setEditorPrefs({ spellcheck: !ui.editorPrefs.spellcheck })"
      >
        {{ $t('settings.spellcheck') }}
      </button>
      <span class="badge">Markdown</span>
      <span class="badge">UTF-8</span>
      <span class="badge" :class="{ ok: ui.autosaveEnabled }">
        <i class="pip" />{{ ui.autosaveEnabled ? $t('status.autosaveOn') : $t('status.autosaveOff') }}
      </span>
    </div>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--bg);
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  color: var(--text-2);
  font-size: 12px;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sep {
  opacity: 0.5;
}

/* 保存状态胶囊 */
.save-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ok);
}

/* Vim 模式徽标：等宽键帽风，普通态灰、插入态琥珀 */
.vim-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1px;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-2);
  background: var(--surface-2);
}

.vim-chip.ins {
  color: var(--accent-strong);
  border-color: var(--accent);
}

.save-state.dirty {
  color: var(--accent-strong);
}

.save-state .pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.badge.toggle {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}

.badge.toggle:hover {
  color: var(--text);
  background: var(--surface-2);
}

.badge.toggle.on {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-2);
  opacity: 0.5;
}

.badge.ok .pip {
  background: var(--ok);
  opacity: 1;
}

/* 主题徽标：主色点 + 名字·变体，点击弹出快捷切换 */
.theme-badge {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-badge .pip.accent {
  background: var(--accent);
  opacity: 1;
}

/* ---------- 主题快捷切换弹层 ---------- */

.theme-anchor {
  position: relative;
  display: inline-flex;
}

/* 遮罩在弹层之下：点击任意空白处收起 */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 88;
}

.theme-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 89;
  width: 300px;
  max-height: min(430px, 60vh);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  background: var(--surface);
  box-shadow: 0 10px 34px rgba(20, 15, 8, 0.18);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border-radius: var(--radius-s);
  text-align: left;
  color: var(--text-2);
  font-size: 12.5px;
}

.tm-row:hover {
  background: var(--surface-2);
  color: var(--text);
}

.tm-row.on {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.tm-row.tm-more {
  margin-top: 3px;
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  border-radius: 0 0 var(--radius-s) var(--radius-s);
  color: var(--text-2);
}

.tm-family {
  flex-wrap: wrap;
}

.tm-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.tm-swatches {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.tm-auto {
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-2);
  font-size: 10.5px;
  white-space: nowrap;
}

.tm-auto:hover {
  color: var(--text);
  border-color: var(--accent);
}

.tm-auto.on {
  color: var(--accent-strong);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.tm-swatch {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14);
  transition: transform 0.12s, border-color 0.12s;
}

.tm-swatch:hover {
  transform: scale(1.15);
}

.tm-swatch.on {
  border-color: var(--accent-strong);
  transform: scale(1.1);
}
</style>
