import { accelKeys, effectiveShortcuts } from '@shared/shortcuts'
import { useUiStore } from '@/stores/ui'

/** 提示文案 + 当前生效快捷键：快捷键可自定义，组合不能写死在词典/模板里。
 *  在模板里直接调用即可（读取 ui.shortcuts，改键后重渲染自动更新）。 */
export function shortcutTitle(id: string, label: string): string {
  const keys = accelKeys(effectiveShortcuts(useUiStore().shortcuts)[id] ?? '').join('+')
  return keys ? `${label} (${keys})` : label
}
