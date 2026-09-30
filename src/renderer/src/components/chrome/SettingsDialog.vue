<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useUiStore, type ThemePref } from '@/stores/ui'
import type { LocalePref } from '@/i18n'

/** 偏好设置弹层：所有改动即时生效并持久化（userData/config.json） */
const ui = useUiStore()

const THEMES: { key: ThemePref; labelKey: string }[] = [
  { key: 'system', labelKey: 'settings.thSystem' },
  { key: 'light', labelKey: 'settings.thLight' },
  { key: 'dark', labelKey: 'settings.thDark' }
]

const LOCALES: { key: LocalePref; labelKey?: string; label?: string }[] = [
  { key: 'system', labelKey: 'settings.lSystem' },
  { key: 'zh-CN', label: '简体中文' },
  { key: 'en', label: 'English' }
]

const INTERVALS: { ms: number; labelKey: string; n: number }[] = [
  { ms: 5000, labelKey: 'settings.sec', n: 5 },
  { ms: 15000, labelKey: 'settings.sec', n: 15 },
  { ms: 30000, labelKey: 'settings.sec', n: 30 },
  { ms: 60000, labelKey: 'settings.sec', n: 60 }
]

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.settingsOpen) ui.settingsOpen = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="settings">
      <div v-if="ui.settingsOpen" class="mask" @click.self="ui.settingsOpen = false">
        <section class="dialog" role="dialog" :aria-label="$t('settings.title')">
          <header class="dialog-head">
            <h2>{{ $t('settings.title') }}</h2>
            <button class="close" :title="$t('settings.closeEsc')" @click="ui.settingsOpen = false">✕</button>
          </header>

          <div class="dialog-body">
            <!-- 外观 -->
            <h3 class="group-title">{{ $t('settings.gAppearance') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.theme') }}</span>
              <div class="segmented">
                <button
                  v-for="t in THEMES"
                  :key="t.key"
                  :class="{ on: ui.themePref === t.key }"
                  @click="ui.setThemePref(t.key)"
                >
                  {{ $t(t.labelKey) }}
                </button>
              </div>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.language') }}</span>
              <div class="segmented">
                <button
                  v-for="l in LOCALES"
                  :key="l.key"
                  :class="{ on: ui.localePref === l.key }"
                  @click="ui.setLocalePref(l.key)"
                >
                  {{ l.labelKey ? $t(l.labelKey) : l.label }}
                </button>
              </div>
            </div>

            <!-- 排版 -->
            <h3 class="group-title">{{ $t('settings.gLayout') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.fontSize') }}</span>
              <input
                type="range"
                min="12"
                max="24"
                step="1"
                :value="ui.editorPrefs.fontSize"
                @input="ui.setEditorPrefs({ fontSize: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="value">{{ ui.editorPrefs.fontSize }}px</span>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.lineHeight') }}</span>
              <input
                type="range"
                min="1.4"
                max="2.2"
                step="0.1"
                :value="ui.editorPrefs.lineHeight"
                @input="ui.setEditorPrefs({ lineHeight: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="value">{{ ui.editorPrefs.lineHeight.toFixed(1) }}</span>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.pageWidth') }}</span>
              <input
                type="range"
                :min="ui.pageWidthMinPct"
                max="100"
                step="1"
                :value="ui.editorPrefs.pageWidthPct"
                @input="ui.setEditorPrefs({ pageWidthPct: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="value">{{ ui.editorPrefs.pageWidthPct }}%</span>
            </div>
            <p class="row-hint">{{ $t('settings.pwHint', { min: ui.pageWidthMinPct }) }}</p>

            <!-- 启动 -->
            <h3 class="group-title">{{ $t('settings.gStartup') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.restoreTabs') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.restoreTabs"
                :class="{ on: ui.restoreTabs }"
                @click="ui.setRestoreTabs(!ui.restoreTabs)"
              >
                <i class="knob" />
              </button>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.restoreFolders') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.restoreFolders"
                :class="{ on: ui.restoreFolders }"
                @click="ui.setRestoreFolders(!ui.restoreFolders)"
              >
                <i class="knob" />
              </button>
            </div>
            <p class="row-hint">{{ $t('settings.startupHint') }}</p>

            <!-- 窗口 -->
            <h3 class="group-title">{{ $t('settings.gWindow') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.closeAction') }}</span>
              <div class="segmented">
                <button
                  :class="{ on: ui.closeAction === 'quit' }"
                  @click="ui.setCloseAction('quit')"
                >
                  {{ $t('settings.cQuit') }}
                </button>
                <button
                  :class="{ on: ui.closeAction === 'tray' }"
                  @click="ui.setCloseAction('tray')"
                >
                  {{ $t('settings.cTray') }}
                </button>
              </div>
            </div>
            <p class="row-hint">{{ $t('settings.closeHint') }}</p>

            <!-- 编辑 -->
            <h3 class="group-title">{{ $t('settings.gEditor') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.autosave') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.autosaveEnabled"
                :class="{ on: ui.autosaveEnabled }"
                @click="ui.setAutosave({ enabled: !ui.autosaveEnabled })"
              >
                <i class="knob" />
              </button>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.interval') }}</span>
              <div class="segmented">
                <button
                  v-for="it in INTERVALS"
                  :key="it.ms"
                  :class="{ on: ui.autosaveIntervalMs === it.ms }"
                  :disabled="!ui.autosaveEnabled"
                  @click="ui.setAutosave({ intervalMs: it.ms })"
                >
                  {{ $t(it.labelKey, { n: it.n }) }}
                </button>
              </div>
            </div>
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
  z-index: 90;
  background: rgba(20, 16, 12, 0.4);
  display: grid;
  place-items: center;
}

.dialog {
  width: 460px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-pop);
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.dialog-head h2 {
  font-size: 14px;
  font-weight: 700;
}

.close {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-s);
  color: var(--text-2);
  font-size: 13px;
}

.close:hover {
  background: var(--danger);
  color: #fff;
}

.dialog-body {
  padding: 6px 18px 18px;
}

.group-title {
  margin: 16px 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--text-2);
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  min-height: 36px;
}

.label {
  width: 72px;
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--text-2);
}

.value {
  width: 56px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent-strong);
  flex-shrink: 0;
}

.row-hint {
  margin: -4px 0 0 84px;
  font-size: 11px;
  color: var(--text-2);
  opacity: 0.8;
}

/* 分段控件 */
.segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-m);
  background: var(--surface-2);
}

.segmented button {
  padding: 4px 12px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

.segmented button.on {
  background: var(--surface);
  color: var(--accent-strong);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(38, 32, 25, 0.1);
}

.segmented button:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 滑杆 */
input[type='range'] {
  flex: 1;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-2);
  outline: none;
}

input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--surface);
  box-shadow: 0 1px 3px rgba(38, 32, 25, 0.3);
  cursor: pointer;
}

/* 开关 */
.switch {
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  transition: background 0.15s;
}

.switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(38, 32, 25, 0.25);
  transition: transform 0.15s;
}

.switch.on {
  background: var(--accent);
  border-color: var(--accent);
}

.switch.on .knob {
  transform: translateX(16px);
}

/* 弹层过渡 */
.settings-enter-active,
.settings-leave-active {
  transition: opacity 0.15s ease;
}

.settings-enter-active .dialog,
.settings-leave-active .dialog {
  transition: transform 0.15s ease;
}

.settings-enter-from,
.settings-leave-to {
  opacity: 0;
}

.settings-enter-from .dialog,
.settings-leave-to .dialog {
  transform: translateY(8px) scale(0.98);
}
</style>
