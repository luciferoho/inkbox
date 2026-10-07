import type { MenuCommand } from './types'

/**
 * 应用级命令快捷键注册表（6.7 快捷键自定义）。
 * 菜单加速器是唯一的全局键源：改键 = 改菜单模板（createMenu 按覆盖表重建），
 * 渲染层命令分发（menu:command → App.dispatch）不感知键位。
 * 编辑器内的格式键（Ctrl+B/I/K 等）不在此表，暂不支持自定义。
 */
/** 渲染层 i18n 键（sc.*）；词典键联合由渲染层侧收窄（见 ShortcutCommand 的 labelKey 用法） */
export interface ShortcutCommand {
  id: MenuCommand
  labelKey: string
  group: 'file' | 'edit' | 'view'
  /** 默认 Electron 加速键（CmdOrCtrl 写法保留跨平台可能） */
  accel: string
}

export const SHORTCUT_COMMANDS: ShortcutCommand[] = [
  { id: 'file:new', labelKey: 'sc.newDoc', group: 'file', accel: 'CmdOrCtrl+N' },
  { id: 'file:open', labelKey: 'sc.openFile', group: 'file', accel: 'CmdOrCtrl+O' },
  { id: 'file:openFolder', labelKey: 'sc.openFolder', group: 'file', accel: 'CmdOrCtrl+Shift+O' },
  { id: 'file:save', labelKey: 'sc.save', group: 'file', accel: 'CmdOrCtrl+S' },
  { id: 'file:saveAs', labelKey: 'sc.saveAs', group: 'file', accel: 'CmdOrCtrl+Shift+S' },
  { id: 'file:export', labelKey: 'sc.export', group: 'file', accel: 'CmdOrCtrl+E' },
  { id: 'file:closeTab', labelKey: 'sc.closeTab', group: 'file', accel: 'CmdOrCtrl+W' },
  { id: 'file:nextTab', labelKey: 'sc.nextTab', group: 'file', accel: 'CmdOrCtrl+Tab' },
  { id: 'file:prevTab', labelKey: 'sc.prevTab', group: 'file', accel: 'CmdOrCtrl+Shift+Tab' },
  { id: 'edit:find', labelKey: 'sc.find', group: 'edit', accel: 'CmdOrCtrl+F' },
  { id: 'view:toggleSidebar', labelKey: 'sc.toggleSidebar', group: 'view', accel: 'CmdOrCtrl+\\' },
  { id: 'view:toggleTheme', labelKey: 'sc.toggleTheme', group: 'view', accel: 'CmdOrCtrl+Alt+T' },
  { id: 'view:toggleFocus', labelKey: 'sc.focus', group: 'view', accel: 'F8' },
  { id: 'view:toggleTypewriter', labelKey: 'sc.typewriter', group: 'view', accel: 'F9' },
  { id: 'view:toggleZen', labelKey: 'sc.zen', group: 'view', accel: 'F10' },
  { id: 'view:toggleSearch', labelKey: 'sc.workspaceSearch', group: 'view', accel: 'CmdOrCtrl+Shift+F' },
  { id: 'view:toggleShortcuts', labelKey: 'sc.shortcutPanel', group: 'view', accel: 'CmdOrCtrl+/' },
  { id: 'app:settings', labelKey: 'sc.settings', group: 'view', accel: 'CmdOrCtrl+,' }
]

/** config.shortcuts：命令 id → 覆盖加速键（'' = 禁用）；缺省项用注册表默认值 */
export type ShortcutOverrides = Record<string, string>

/** 生效加速键表：主进程建菜单与渲染层面板/设置页共用 */
export function effectiveShortcuts(overrides?: ShortcutOverrides): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of SHORTCUT_COMMANDS) out[c.id] = overrides?.[c.id] ?? c.accel
  return out
}

/** 展示用：CmdOrCtrl → Ctrl（当前仅 Windows/Linux），拆成键帽列表 */
export function accelKeys(accel: string): string[] {
  if (accel === '') return []
  return accel.split('+').map((p) => (p === 'CmdOrCtrl' || p === 'CommandOrControl' ? 'Ctrl' : p))
}

/* ---------- 改键捕获与冲突检测（设置页用） ---------- */

const KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc'
}

const F_KEY = /^F([1-9]|1[0-9]|2[0-4])$/

/** 捕获事件的最小结构（DOM KeyboardEvent 天然满足；主进程 tsconfig 无 DOM lib，不直接引用它） */
interface CaptureEvent {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** keydown → 加速键字符串；纯修饰键（组合未成形）返回 null */
export function accelFromEvent(e: CaptureEvent): string | null {
  const raw = e.key
  if (raw === 'Control' || raw === 'Shift' || raw === 'Alt' || raw === 'Meta') return null
  const key = KEY_MAP[raw] ?? (F_KEY.test(raw) ? raw : raw.length === 1 ? raw.toUpperCase() : raw)
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** 合法性：必须含 Ctrl/Alt 或为功能键——单字母/单数字会拦截正常打字，不允许注册 */
export function isValidAccel(accel: string): boolean {
  if (accel === '') return true
  const parts = accel.split('+')
  if (F_KEY.test(parts[parts.length - 1])) return true
  return parts.includes('CmdOrCtrl') || parts.includes('Alt') || parts.includes('Super')
}

/** 冲突比较归一：修饰键统一命名排序，键名大写不区分大小写 */
export function normalizeForCompare(accel: string): string {
  if (accel === '') return ''
  const parts = accel.split('+').map((p) => {
    if (p === 'CmdOrCtrl' || p === 'CommandOrControl' || p === 'Ctrl') return 'CTRL'
    if (p === 'Shift') return 'SHIFT'
    if (p === 'Alt') return 'ALT'
    if (p === 'Super') return 'SUPER'
    return p.toUpperCase()
  })
  const key = parts.pop() as string
  return [...parts.sort(), key].join('+')
}

/** 固定占用（role 菜单项与编辑器内置键），改键时一并查冲突 */
export const RESERVED_ACCELS: string[] = [
  'CmdOrCtrl+Z',
  'CmdOrCtrl+Shift+Z',
  'CmdOrCtrl+Y',
  'CmdOrCtrl+X',
  'CmdOrCtrl+C',
  'CmdOrCtrl+V',
  'CmdOrCtrl+A',
  'CmdOrCtrl+Q',
  'CmdOrCtrl+=',
  'CmdOrCtrl+-',
  'CmdOrCtrl+0',
  'CmdOrCtrl+B',
  'CmdOrCtrl+I',
  'CmdOrCtrl+K',
  'CmdOrCtrl+Shift+X',
  'CmdOrCtrl+Shift+C',
  /* 结构类内置键（cm-commands formattingKeymap，不进设置页但不可被改键占用） */
  'CmdOrCtrl+1',
  'CmdOrCtrl+2',
  'CmdOrCtrl+3',
  'CmdOrCtrl+4',
  'CmdOrCtrl+5',
  'CmdOrCtrl+6',
  'CmdOrCtrl+Shift+BracketLeft',
  'CmdOrCtrl+Shift+BracketRight',
  'CmdOrCtrl+Shift+Q',
  'CmdOrCtrl+Shift+K',
  'CmdOrCtrl+T',
  'F11',
  'F12',
  'CmdOrCtrl+Shift+I'
]
