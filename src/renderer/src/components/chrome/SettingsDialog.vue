<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore, type ThemePref } from '@/stores/ui'
import type { LocalePref } from '@/i18n'
import type { MenuCommand, PluginInfo } from '@shared/types'
import {
  SHORTCUT_COMMANDS,
  effectiveShortcuts,
  accelKeys,
  accelFromEvent,
  isValidAccel,
  normalizeForCompare,
  RESERVED_ACCELS
} from '@shared/shortcuts'
import { t, type MsgKey } from '@/i18n'

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

/* ---------- 快捷键自定义：行内录制改键，录制期间主进程挂起应用菜单 ---------- */

const captureId = ref<MenuCommand | null>(null)
const eff = computed(() => effectiveShortcuts(ui.shortcuts))

function startCapture(id: MenuCommand): void {
  stopCapture()
  captureId.value = id
  window.api.app.setShortcutsCapture(true)
  // 捕获阶段监听：抢在设置弹窗自身 Esc（冒泡）之前消费按键
  window.addEventListener('keydown', onCaptureKey, true)
}

function stopCapture(): void {
  if (captureId.value === null) return
  captureId.value = null
  window.removeEventListener('keydown', onCaptureKey, true)
  window.api.app.setShortcutsCapture(false)
}

/** 录制中关掉弹窗/组件卸载：必须恢复应用菜单 */
watch(
  () => ui.settingsOpen,
  (open) => {
    if (!open) stopCapture()
  }
)
onBeforeUnmount(stopCapture)

function onCaptureKey(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopCapture()
    return
  }
  const id = captureId.value
  if (id === null) return
  // 单独 Backspace/Delete = 清除该命令的快捷键
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    void applyAccel(id, '')
    return
  }
  const accel = accelFromEvent(e)
  if (accel !== null) void applyAccel(id, accel)
}

async function applyAccel(id: MenuCommand, accel: string): Promise<void> {
  if (accel !== '') {
    if (!isValidAccel(accel)) {
      ui.showToast(t('settings.scNeedMod'))
      return // 保持录制态，可直接再按
    }
    const norm = normalizeForCompare(accel)
    for (const other of SHORTCUT_COMMANDS) {
      if (other.id !== id && normalizeForCompare(eff.value[other.id]) === norm) {
        ui.showToast(t('settings.scConflict', { name: t(other.labelKey as MsgKey) }))
        return
      }
    }
    if (RESERVED_ACCELS.some((r) => normalizeForCompare(r) === norm)) {
      ui.showToast(t('settings.scReserved'))
      return
    }
  }
  // 与默认值相同则删除覆盖项（配置里只留真实偏离），恢复默认按钮随之隐藏
  const def = SHORTCUT_COMMANDS.find((c) => c.id === id)?.accel
  const next = { ...ui.shortcuts }
  if (accel === def) delete next[id]
  else next[id] = accel
  await ui.setShortcuts(next)
  stopCapture()
}

function resetOne(id: MenuCommand): void {
  const next = { ...ui.shortcuts }
  delete next[id]
  void ui.setShortcuts(next)
}

/* ---------- 插件：发现清单渲染 + 开关禁用（6.9） ---------- */

function pluginEnabled(p: PluginInfo): boolean {
  return !p.error && !ui.pluginsDisabled.includes(p.manifest.id)
}

/** 插件当前显示的错误：清单错误（发现期）或运行期错误（pluginHost 标记） */
function pluginError(p: PluginInfo): string {
  return p.error ?? ui.pluginErrors[p.manifest.id] ?? ''
}

function togglePlugin(p: PluginInfo): void {
  void ui.setPluginEnabled(p.manifest.id, !pluginEnabled(p))
}
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
                :value="ui.winPrefs.pageWidthPct"
                @input="ui.setPageWidth(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="value">{{ ui.winPrefs.pageWidthPct }}%</span>
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
            <div class="row">
              <span class="label">{{ $t('settings.openAtLogin') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.openAtLogin"
                :class="{ on: ui.openAtLogin }"
                @click="ui.setOpenAtLogin(!ui.openAtLogin)"
              >
                <i class="knob" />
              </button>
            </div>
            <p class="row-hint">{{ $t('settings.openAtLoginHint') }}</p>
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
              <span class="label">{{ $t('settings.vimMode') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.vimMode"
                :class="{ on: ui.vimMode }"
                @click="ui.setVimMode(!ui.vimMode)"
              >
                <i class="knob" />
              </button>
            </div>
            <p class="row-hint">{{ $t('settings.vimModeHint') }}</p>
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

            <!-- 图床：PicGo server 协议上传 -->
            <h3 class="group-title">{{ $t('settings.gUpload') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.uploadEnabled') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.upload.enabled"
                :class="{ on: ui.upload.enabled }"
                @click="ui.setUpload({ enabled: !ui.upload.enabled })"
              >
                <i class="knob" />
              </button>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.uploadServer') }}</span>
              <input
                v-model="ui.upload.server"
                class="url-input"
                type="text"
                spellcheck="false"
                :disabled="!ui.upload.enabled"
                :title="$t('settings.uploadServer')"
                @change="ui.setUpload({ server: ui.upload.server.trim() })"
              />
            </div>
            <p class="row-hint">{{ $t('settings.uploadHint') }}</p>

            <!-- 快捷键：应用级命令可改键，行内录制 -->
            <h3 class="group-title">{{ $t('settings.gShortcuts') }}</h3>
            <div
              v-for="c in SHORTCUT_COMMANDS"
              :key="c.id"
              class="row sc-row"
              :class="{ capturing: captureId === c.id }"
            >
              <span class="label sc-label" :title="$t(c.labelKey as MsgKey)">{{ $t(c.labelKey as MsgKey) }}</span>
              <template v-if="captureId === c.id">
                <span class="sc-capture">{{ $t('settings.scCapture') }}</span>
              </template>
              <template v-else>
                <span class="sc-keys">
                  <template v-if="accelKeys(eff[c.id]).length">
                    <kbd v-for="(k, i) in accelKeys(eff[c.id])" :key="i">{{ k }}</kbd>
                  </template>
                  <span v-else class="sc-unset">{{ $t('settings.scDisabled') }}</span>
                </span>
                <span class="sc-actions">
                  <button class="sc-btn" @click="startCapture(c.id)">{{ $t('settings.scRebind') }}</button>
                  <button
                    v-if="ui.shortcuts[c.id] !== undefined"
                    class="sc-btn"
                    @click="resetOne(c.id)"
                  >
                    {{ $t('settings.scReset') }}
                  </button>
                </span>
              </template>
            </div>
            <p class="row-hint">{{ $t('settings.scHint') }}</p>

            <!-- 插件：userData/plugins 扫描发现，开关即禁用/启用（6.9） -->
            <h3 class="group-title">{{ $t('settings.gPlugins') }}</h3>
            <template v-if="ui.plugins.length">
              <div v-for="p in ui.plugins" :key="p.dir" class="row plugin-row">
                <span class="label plugin-label">
                  <span class="plugin-name">
                    {{ p.manifest.name || p.dir.split(/[\\/]/).pop() }}
                    <span v-if="p.builtin" class="plugin-badge">{{ $t('settings.pluginBuiltin') }}</span>
                    <span v-if="p.manifest.version" class="plugin-ver">v{{ p.manifest.version }}</span>
                  </span>
                  <span v-if="pluginError(p)" class="plugin-err">{{ pluginError(p) }}</span>
                  <span v-else-if="p.manifest.description" class="plugin-desc">{{ p.manifest.description }}</span>
                </span>
                <button
                  v-if="!p.error"
                  class="switch"
                  role="switch"
                  :aria-checked="pluginEnabled(p)"
                  :class="{ on: pluginEnabled(p) }"
                  @click="togglePlugin(p)"
                >
                  <i class="knob" />
                </button>
              </div>
            </template>
            <p v-else class="row-hint">{{ $t('settings.pluginsEmpty') }}</p>
            <div class="row">
              <span class="label"></span>
              <span class="plugin-actions">
                <button class="sc-btn" @click="ui.openPluginsDir()">{{ $t('settings.pluginsOpenDir') }}</button>
                <button class="sc-btn" @click="ui.reloadPlugins()">{{ $t('settings.pluginsReload') }}</button>
              </span>
            </div>
            <p class="row-hint">{{ $t('settings.pluginsHint') }}</p>
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

/* 图床服务地址输入 */
.url-input {
  flex: 1;
  min-width: 0;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.url-input:focus {
  outline: none;
  border-color: var(--accent);
}

.url-input:disabled {
  opacity: 0.45;
}

/* 快捷键段：命令名不压缩，键帽 + 操作靠右 */
.sc-row.capturing {
  background: var(--accent-soft);
  border-radius: var(--radius-m);
  padding-left: 8px;
  padding-right: 8px;
}

.sc-row .label {
  width: auto;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-keys {
  display: inline-flex;
  gap: 3px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.sc-keys kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  white-space: nowrap;
}

.sc-unset {
  font-size: 11px;
  color: var(--text-2);
  opacity: 0.75;
}

.sc-capture {
  font-size: 11.5px;
  color: var(--accent-strong);
  flex: 1;
  min-width: 0;
}

.sc-actions {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
}

.sc-btn {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: var(--radius-s);
  border: 1px solid var(--border);
  color: var(--text-2);
  white-space: nowrap;
}

.sc-btn:hover {
  color: var(--accent-strong);
  border-color: var(--accent);
  background: var(--accent-soft);
}

/* 插件段：整行卡条（hover 起底），名字 + 徽章/版本，描述与错误两行完整展示。
   .label 基类钉死 72px 宽，插件行要撑满剩余空间（名称/描述都长） */
.plugin-row {
  align-items: flex-start;
  padding: 8px 10px;
  margin: 0 -10px;
  border-radius: var(--radius-m);
  transition: background 0.15s ease;
}

.plugin-row:hover {
  background: var(--surface-2);
}

.plugin-label {
  width: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding-top: 2px;
}

.plugin-name {
  font-weight: 600;
  color: var(--text-1);
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.plugin-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.plugin-ver {
  flex-shrink: 0;
  font-weight: 400;
  font-size: 11px;
  color: var(--text-3);
}

.plugin-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-3);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.plugin-err {
  font-size: 12px;
  line-height: 1.5;
  color: var(--danger, #c0392b);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.plugin-actions {
  display: flex;
  gap: 8px;
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
