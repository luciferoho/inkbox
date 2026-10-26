<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore, type ThemePref } from '@/stores/ui'
import type { LocalePref } from '@/i18n'
import type { AppInfo, MenuCommand, PluginInfo, ThemeInfo } from '@shared/types'
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
import {
  BODY_FONT_OPTIONS,
  CODE_FONT_OPTIONS,
  customFontOptions,
  isGeneratedName,
  scanFontFaces,
  type ScannedFontFace
} from '@/services/font-scan'

/** 偏好设置弹层：所有改动即时生效并持久化（userData/config.json） */
const ui = useUiStore()

const THEMES: { key: ThemePref; labelKey: string }[] = [
  { key: 'system', labelKey: 'settings.thSystem' },
  { key: 'light', labelKey: 'settings.thLight' },
  { key: 'dark', labelKey: 'settings.thDark' }
]

/* ---------- M3 外观扩展：外部 CSS 主题 / 字体族 / 自定义 CSS ---------- */
const themeFiles = ref<ThemeInfo[]>([])
const VI_VARIANT_ORDER = ['light', 'dark', 'grey']
function variantLabel(key: string): string {
  if (key === 'light') return t('settings.thLight')
  if (key === 'dark') return t('settings.thDark')
  if (key === 'grey') return t('settings.variantGrey')
  return key
}
/** 主题族：同族文件（xxx / xxx-dark / xxx-grey）合成一个下拉项；
 *  配色族（phycat-* → phycat）标注配色数量 */
const themeFamilies = computed(() => {
  const map = new Map<string, ThemeInfo[]>()
  for (const t of themeFiles.value) {
    const arr = map.get(t.family)
    if (arr) arr.push(t)
    else map.set(t.family, [t])
  }
  return [...map.entries()]
    .map(([family, files]) => {
      const color = files.some((f) => f.colorFamily)
      const keys = [...new Set(files.map((f) => f.variantKey))].sort(
        (a, b) => (VI_VARIANT_ORDER.indexOf(a) + 1 || 99) - (VI_VARIANT_ORDER.indexOf(b) + 1 || 99)
      )
      const hint = color
        ? t('settings.colorVariants', { n: files.length })
        : keys.map(variantLabel).join('/')
      const name = files.length > 1 ? family : files[0].name
      return { key: files.length > 1 ? family : files[0].name, label: `${name}（${hint}）` }
    })
    .sort((a, b) => a.key.localeCompare(b.key))
})
/** 三变体以上（含配色族）用色板圆点切换；单色 / 浅深双色保持 segmented */
const showVariantDots = computed(() => currentFamily.value.length >= 3)
/** 变体圆点：主色缺失时按极性给兜底色（深灰/纸白/中灰） */
const variantDots = computed(() => {
  const fam = currentFamily.value
  if (!showVariantDots.value) return [] as { key: string; label: string; color: string }[]
  const order = (k: string): number => VI_VARIANT_ORDER.indexOf(k) + 1 || 99
  const fallback = (x: ThemeInfo): string =>
    x.color || (x.variant === 'dark' ? '#3b3b3b' : x.variant === 'light' ? '#f2efe9' : '#9a9a92')
  return [...fam]
    .sort((a, b) => order(a.variantKey) - order(b.variantKey) || a.variantKey.localeCompare(b.variantKey))
    .map((x) => ({ key: x.variantKey, label: variantLabel(x.variantKey), color: fallback(x) }))
})
/** 当前主题族的全部变体（用于“主题变体”选择行） */
const currentFamily = computed(() => {
  const key = ui.appearance.themeCss
  if (!key) return [] as ThemeInfo[]
  const fam = themeFiles.value.filter((x) => x.family === key)
  return fam.length ? fam : themeFiles.value.filter((x) => x.name === key)
})
const variantOptions = computed(() => {
  const fam = currentFamily.value
  if (fam.length <= 1) return [] as { key: string; label: string }[]
  const hasLight = fam.some((x) => x.variant === 'light')
  const hasDark = fam.some((x) => x.variant === 'dark')
  const opts: { key: string; label: string }[] = []
  if (hasLight && hasDark) opts.push({ key: 'auto', label: t('settings.variantAuto') })
  const keys = [...new Set(fam.map((x) => x.variantKey))].sort(
    (a, b) => (VI_VARIANT_ORDER.indexOf(a) + 1 || 99) - (VI_VARIANT_ORDER.indexOf(b) + 1 || 99)
  )
  for (const k of keys) opts.push({ key: k, label: variantLabel(k) })
  return opts
})
function pickTheme(name: string): void {
  const fam = themeFiles.value.filter((x) => x.family === name)
  const hasPair = fam.some((x) => x.variant === 'light') && fam.some((x) => x.variant === 'dark')
  // 有浅/深成对默认自动跟随；单变体族直接固定该变体，便于锁定判断
  const variant = hasPair ? 'auto' : (fam[0]?.variantKey ?? 'auto')
  void ui.setAppearance({ themeCss: name, themeVariant: variant })
}
function pickVariant(key: string): void {
  void ui.setAppearance({ themeVariant: key })
}
async function reloadThemes(): Promise<void> {
  themeFiles.value = await window.api.theme.list()
  // 旧配置存的是变体文件名（xxx-dark / xxx-grey），归一成族键 + 固定变体
  const cur = ui.appearance.themeCss
  if (!cur || themeFamilies.value.some((f) => f.key === cur)) return
  const hit = themeFiles.value.find((x) => x.name === cur)
  if (!hit) return
  const familyKey = hit.family !== hit.name ? hit.family : hit.name
  if (themeFamilies.value.some((f) => f.key === familyKey)) {
    void ui.setAppearance({
      themeCss: familyKey,
      themeVariant: hit.family !== hit.name ? hit.variantKey : ui.appearance.themeVariant
    })
  }
}
/* ---------- 字体下拉：内置系统字体 + themes/fonts/ 扫描的自定义字体 ---------- */
const fontFaces = ref<ScannedFontFace[]>([])
const customBodyFonts = computed(() => customFontOptions(fontFaces.value, 'sans-serif').filter((o) => !isGeneratedName(o.label)))
const customCodeFonts = computed(() => customFontOptions(fontFaces.value, 'monospace').filter((o) => !isGeneratedName(o.label)))
const otherBodyFonts = computed(() => customFontOptions(fontFaces.value, 'sans-serif').filter((o) => isGeneratedName(o.label)))
const otherCodeFonts = computed(() => customFontOptions(fontFaces.value, 'monospace').filter((o) => isGeneratedName(o.label)))
function fontValues(kind: 'bodyFont' | 'codeFont'): Set<string> {
  const built = kind === 'bodyFont' ? BODY_FONT_OPTIONS : CODE_FONT_OPTIONS
  const custom = kind === 'bodyFont' ? customBodyFonts.value : customCodeFonts.value
  const other = kind === 'bodyFont' ? otherBodyFonts.value : otherCodeFonts.value
  return new Set([...built, ...custom, ...other].map((o) => o.value))
}
function fontChoice(kind: 'bodyFont' | 'codeFont'): string {
  return (kind === 'bodyFont' ? ui.appearance.bodyFont : ui.appearance.codeFont) ?? ''
}
function pickFont(kind: 'bodyFont' | 'codeFont', sel: string): void {
  void ui.setAppearance(kind === 'bodyFont' ? { bodyFont: sel } : { codeFont: sel })
}
/** 历史手输值不在选项表里：补一个同值选项让它可见（换选任意项即被替换） */
function fontLegacy(kind: 'bodyFont' | 'codeFont'): string {
  const v = fontChoice(kind)
  return v && !fontValues(kind).has(v) ? v : ''
}
async function reloadFonts(): Promise<void> {
  fontFaces.value = scanFontFaces(await window.api.theme.listFonts())
}

// 每次打开设置都刷新一次（用户可能刚往目录里放了新主题/新字体）
watch(
  () => ui.settingsOpen,
  (open) => {
    if (open) {
      void reloadThemes()
      void reloadFonts()
    }
  }
)
function openThemesDir(): void {
  void window.api.theme.openDir()
}
function openUserCss(): void {
  void window.api.theme.openUserCss()
}

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

/* ---------- 双栏布局：左侧导航 + 右侧当前分区内容 ---------- */
type SettingsNav = 'appearance' | 'startup' | 'editor' | 'upload' | 'shortcuts' | 'plugins' | 'about'
const nav = ref<SettingsNav>('appearance')
const NAVS: { key: SettingsNav; labelKey: string }[] = [
  { key: 'appearance', labelKey: 'settings.navAppearance' },
  { key: 'startup', labelKey: 'settings.navStartup' },
  { key: 'editor', labelKey: 'settings.gEditor' },
  { key: 'upload', labelKey: 'settings.gUpload' },
  { key: 'shortcuts', labelKey: 'settings.gShortcuts' },
  { key: 'plugins', labelKey: 'settings.gPlugins' },
  { key: 'about', labelKey: 'settings.navAbout' }
]

/* ---------- 关于：应用信息 + 手动检查更新 ---------- */
const appInfo = ref<AppInfo>({
  version: '',
  electron: '',
  chrome: '',
  node: '',
  platform: '',
  packaged: false
})
onMounted(() => {
  void window.api.app.getInfo().then((i) => (appInfo.value = i))
})

function checkUpdate(): void {
  ui.updateDialogOpen = true
  // 主动检查标记：「已是最新」时用 toast 轻提示（启动自动检查保持静默）
  ui.updateCheckByUser = true
  // 首次点击主动检查;已下载待装/下载中则弹窗直接呈现对应阶段
  if (['idle', 'none', 'error'].includes(ui.updateState.phase)) void window.api.update.check()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="settings">
      <div v-if="ui.settingsOpen" class="mask" @click.self="ui.settingsOpen = false">
        <section class="dialog settings-dialog" role="dialog" :aria-label="$t('settings.title')">
          <header class="dialog-head">
            <h2>{{ $t('settings.title') }}</h2>
            <button class="close" :title="$t('settings.closeEsc')" @click="ui.settingsOpen = false">✕</button>
          </header>

          <div class="settings-layout">
            <nav class="settings-nav">
              <button
                v-for="n in NAVS"
                :key="n.key"
                class="settings-nav-item"
                :class="{ on: nav === n.key }"
                @click="nav = n.key"
              >
                {{ $t(n.labelKey as MsgKey) }}
              </button>
            </nav>

            <div class="settings-body">
              <!-- 外观与排版 -->
              <template v-if="nav === 'appearance'">
                <h3 class="group-title">{{ $t('settings.gAppearance') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.theme') }}</span>
              <div class="segmented">
                <button
                  v-for="t in THEMES"
                  :key="t.key"
                  :class="{ on: ui.themePref === t.key }"
                  :disabled="!!(ui.themeLock || ui.themeSwitchLocked)"
                  @click="ui.setThemePref(t.key)"
                >
                  {{ $t(t.labelKey) }}
                </button>
              </div>
            </div>
            <p v-if="ui.themeLock" class="row-hint">
              {{ $t('settings.themeLockedHint', { mode: ui.themeLock === 'dark' ? $t('settings.thDark') : $t('settings.thLight') }) }}
            </p>
            <p v-else-if="ui.themeSwitchLocked" class="row-hint">
              {{ $t('settings.variantLockedHint') }}
            </p>
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

            <!-- 主题样式与字体（M3） -->
            <h3 class="group-title">{{ $t('settings.themeCss') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.themeCss') }}</span>
              <select class="theme-select" :value="ui.appearance.themeCss" @change="pickTheme(($event.target as HTMLSelectElement).value)">
                <option value="">{{ $t('settings.themeDefault') }}</option>
                <option v-for="th in themeFamilies" :key="th.key" :value="th.key">{{ th.label }}</option>
              </select>
              <button class="link-btn" @click="openThemesDir">{{ $t('settings.openThemesDir') }}</button>
            </div>
            <p class="row-hint">{{ $t('settings.themeCssHint') }}</p>
            <div v-if="variantOptions.length" class="row">
              <span class="label">{{ $t('settings.themeVariant') }}</span>
              <!-- 三变体以上（配色族/浅深灰）：自动跟随 + 主色圆点（排不下 segmented） -->
              <div v-if="showVariantDots" class="swatch-row">
                <button
                  v-if="variantOptions.some((v) => v.key === 'auto')"
                  class="swatch-auto"
                  :class="{ on: (ui.appearance.themeVariant || 'auto') === 'auto' }"
                  @click="pickVariant('auto')"
                >
                  {{ $t('settings.variantAuto') }}
                </button>
                <button
                  v-for="s in variantDots"
                  :key="s.key"
                  class="swatch"
                  :class="{ on: (ui.appearance.themeVariant || 'auto') === s.key }"
                  :title="s.label"
                  :style="{ background: s.color }"
                  @click="pickVariant(s.key)"
                />
              </div>
              <div v-else class="segmented">
                <button
                  v-for="v in variantOptions"
                  :key="v.key"
                  :class="{ on: (ui.appearance.themeVariant || 'auto') === v.key }"
                  @click="pickVariant(v.key)"
                >
                  {{ v.label }}
                </button>
              </div>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.bodyFont') }}</span>
              <select
                class="theme-select font-select"
                :value="fontChoice('bodyFont')"
                @change="pickFont('bodyFont', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ $t('settings.fontDefault') }}</option>
                <option v-if="fontLegacy('bodyFont')" :value="fontLegacy('bodyFont')">{{ fontLegacy('bodyFont') }}</option>
                <optgroup :label="$t('settings.fontSystemGroup')">
                  <option v-for="f in BODY_FONT_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
                </optgroup>
                <optgroup v-if="customBodyFonts.length" :label="$t('settings.fontCustomGroup')">
                  <option v-for="f in customBodyFonts" :key="f.value" :value="f.value">{{ f.label }}</option>
                </optgroup>
                <optgroup v-if="otherBodyFonts.length" :label="$t('settings.fontOtherGroup')">
                  <option v-for="f in otherBodyFonts" :key="f.value" :value="f.value">{{ f.label }}</option>
                </optgroup>
              </select>
            </div>
            <div class="row">
              <span class="label">{{ $t('settings.codeFont') }}</span>
              <select
                class="theme-select font-select"
                :value="fontChoice('codeFont')"
                @change="pickFont('codeFont', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ $t('settings.fontDefault') }}</option>
                <option v-if="fontLegacy('codeFont')" :value="fontLegacy('codeFont')">{{ fontLegacy('codeFont') }}</option>
                <optgroup :label="$t('settings.fontSystemGroup')">
                  <option v-for="f in CODE_FONT_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
                </optgroup>
                <optgroup v-if="customCodeFonts.length" :label="$t('settings.fontCustomGroup')">
                  <option v-for="f in customCodeFonts" :key="f.value" :value="f.value">{{ f.label }}</option>
                </optgroup>
                <optgroup v-if="otherCodeFonts.length" :label="$t('settings.fontOtherGroup')">
                  <option v-for="f in otherCodeFonts" :key="f.value" :value="f.value">{{ f.label }}</option>
                </optgroup>
              </select>
            </div>
            <p class="row-hint">{{ $t('settings.fontScanHint') }}</p>
            <div class="row">
              <span class="label">{{ $t('settings.userCss') }}</span>
              <button class="link-btn" @click="openUserCss">{{ $t('settings.openUserCss') }}</button>
            </div>
            <p class="row-hint">{{ $t('settings.userCssHint') }}</p>

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
              <span class="label">{{ $t('settings.contentWidth') }}</span>
              <input
                type="range"
                :min="ui.contentWidthMin"
                :max="ui.contentWidthMax"
                step="10"
                :value="ui.editorPrefs.contentWidth"
                @input="ui.setEditorPrefs({ contentWidth: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="value">{{ ui.editorPrefs.contentWidth }}px</span>
            </div>
            <p class="row-hint">{{ $t('settings.cwHint', { min: ui.contentWidthMin }) }}</p>
              </template>

              <!-- 启动与窗口 -->
              <template v-else-if="nav === 'startup'">
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

            <!-- 工作区 -->
            <h3 class="group-title">{{ $t('settings.gWorkspace') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.wsOpenableOnly') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.wsOpenableOnly"
                :class="{ on: ui.wsOpenableOnly }"
                @click="ui.setWsOpenableOnly(!ui.wsOpenableOnly)"
              >
                <i class="knob" />
              </button>
            </div>
            <p class="row-hint">{{ $t('settings.wsOpenableOnlyHint') }}</p>

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
              </template>

              <!-- 编辑 -->
              <template v-else-if="nav === 'editor'">
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
              <span class="label">{{ $t('settings.autosaveSilent') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.autosaveSilent"
                :class="{ on: ui.autosaveSilent }"
                :disabled="!ui.autosaveEnabled"
                @click="ui.setAutosave({ silent: !ui.autosaveSilent })"
              >
                <i class="knob" />
              </button>
            </div>
            <p class="row-hint">{{ $t('settings.autosaveSilentHint') }}</p>
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

            <h3 class="group-title">{{ $t('settings.gWriting') }}</h3>
            <div class="row">
              <span class="label">{{ $t('settings.typographer') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.editorPrefs.typographer"
                :class="{ on: ui.editorPrefs.typographer }"
                @click="ui.setEditorPrefs({ typographer: !ui.editorPrefs.typographer })"
              >
                <i class="knob" />
              </button>
            </div>
            <p class="row-hint">{{ $t('settings.typographerHint') }}</p>
            <div class="row">
              <span class="label">{{ $t('settings.spellcheck') }}</span>
              <button
                class="switch"
                role="switch"
                :aria-checked="ui.editorPrefs.spellcheck"
                :class="{ on: ui.editorPrefs.spellcheck }"
                @click="ui.setEditorPrefs({ spellcheck: !ui.editorPrefs.spellcheck })"
              >
                <i class="knob" />
              </button>
            </div>
            <p class="row-hint">{{ $t('settings.spellcheckHint') }}</p>
              </template>

              <!-- 图床：PicGo server 协议上传 -->
              <template v-else-if="nav === 'upload'">
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
              </template>

              <!-- 快捷键：应用级命令可改键，行内录制 -->
              <template v-else-if="nav === 'shortcuts'">
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
                  <kbd v-if="accelKeys(eff[c.id]).length">{{ accelKeys(eff[c.id]).join('+') }}</kbd>
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
              </template>

              <!-- 插件：userData/plugins 扫描发现，开关即禁用/启用（6.9） -->
              <template v-else-if="nav === 'plugins'">
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
              </template>

              <!-- 关于 -->
              <template v-else-if="nav === 'about'">
                <h3 class="group-title">{{ $t('settings.navAbout') }}</h3>
            <div class="about-hero">
              <svg class="about-spark" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                <path
                  d="M12 2c.6 4.8 2.4 7 7.2 7.6-4.8.9-6.6 3.1-7.2 8-0.6-4.9-2.4-7.1-7.2-8C9.6 9 11.4 6.8 12 2z"
                  fill="currentColor"
                />
              </svg>
              <div>
                <div class="about-name">
                  墨匣 Inkbox
                  <span class="about-ver">v{{ appInfo.version }}</span>
                </div>
                <div class="about-tagline">{{ $t('titlebar.tagline') }}</div>
              </div>
            </div>
            <div class="row">
              <span class="label">{{ $t('about.author') }}</span>
              <a class="about-link" href="https://github.com/luciferoho" target="_blank" rel="noopener noreferrer">Lucifer ↗</a>
            </div>
            <div class="row">
              <span class="label">{{ $t('about.repo') }}</span>
              <a class="about-link" href="https://github.com/luciferoho/inkbox" target="_blank" rel="noopener noreferrer">luciferoho/inkbox ↗</a>
            </div>
            <div class="row">
              <span class="label">{{ $t('about.issues') }}</span>
              <a class="about-link" href="https://github.com/luciferoho/inkbox/issues" target="_blank" rel="noopener noreferrer">{{ $t('about.issuesEntry') }} ↗</a>
            </div>
            <div class="row">
              <span class="label">{{ $t('about.license') }}</span>
              <span class="about-text">MIT</span>
            </div>
            <div class="row">
              <span class="label">{{ $t('about.checkUpdate') }}</span>
              <button class="about-check" @click="checkUpdate">
                {{ $t('about.checkUpdateBtn') }}
              </button>
            </div>
            <p v-if="appInfo.electron" class="row-hint">
              Electron {{ appInfo.electron }} · Chromium {{ appInfo.chrome }} · Node {{ appInfo.node }}
            </p>
              </template>
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
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-pop);
}

/* 双栏设置弹窗：内容多到 10 个分组后，单列滚动过长——左侧导航切换分区 */
.settings-dialog {
  width: min(760px, calc(100vw - 56px));
  height: min(620px, calc(100vh - 72px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-layout {
  flex: 1;
  min-height: 0;
  display: flex;
}

.settings-nav {
  width: 168px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.settings-nav-item {
  text-align: left;
  padding: 8px 12px;
  border-radius: var(--radius-s);
  font-size: 13px;
  color: var(--text-2);
  transition: background 0.12s, color 0.12s;
}

.settings-nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.settings-nav-item.on {
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-weight: 600;
}

.settings-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 14px 22px 20px;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
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
  width: 96px;
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
  margin: -4px 0 0 108px;
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

/* M3：外部主题选择 / 字体输入 / 目录跳转按钮 */
.theme-select {
  min-width: 200px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font-size: 12.5px;
}

.font-input {
  flex: 1;
  max-width: 360px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  font-size: 12.5px;
}
.font-input:focus {
  outline: none;
  border-color: var(--accent);
}

.link-btn {
  padding: 4px 10px;
  border-radius: var(--radius-s);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--accent-strong);
  font-size: 12px;
  white-space: nowrap;
}
.link-btn:hover {
  background: var(--accent-soft);
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

/* 联动禁用下的选中项：保留选中记录但明确不可操作 */
.segmented button.on:disabled {
  opacity: 0.45;
}

.segmented button:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 配色族色板：自动跟随按钮 + 主色圆点（phycat 11 色一行排开） */
.swatch-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  min-width: 0;
}

.swatch-auto {
  padding: 4px 10px;
  border-radius: var(--radius-s);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
  transition: border-color 0.12s, color 0.12s;
}

.swatch-auto.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-weight: 600;
}

.swatch {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  transition: transform 0.12s, border-color 0.12s, box-shadow 0.12s;
}

.swatch:hover {
  transform: scale(1.12);
}

.swatch.on {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 2px var(--accent-soft);
  transform: scale(1.08);
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

/* 依赖项关闭时（如自动保存关 → 静默保存禁用）：视觉置灰且不可点 */
.switch:disabled {
  opacity: 0.4;
  cursor: default;
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

/* ---------- 关于 ---------- */
.about-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0 18px;
}

.about-spark {
  color: var(--accent);
  flex-shrink: 0;
}

.about-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
}

.about-ver {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 8px;
  border-radius: 999px;
}

.about-tagline {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-2);
}

.about-link,
.about-text {
  font-size: 12.5px;
  color: var(--text-2);
  text-decoration: none;
}

.about-link:hover {
  color: var(--accent);
}

.about-check {
  min-width: 96px;
  height: 28px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
}

.about-check:hover:not(:disabled) {
  filter: brightness(0.97);
}

.about-check:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
