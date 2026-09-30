import { createI18n } from 'vue-i18n'
import { zh, type MsgKey } from './zh-CN'
import { en } from './en'

export type LocalePref = 'system' | 'zh-CN' | 'en'

/** system 偏好的实际解析：浏览器语言前缀 zh 归中文，其余归英文 */
export function resolveLocale(pref: LocalePref): 'zh-CN' | 'en' {
  if (pref !== 'system') return pref
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true, // 模板里可直接用 $t
  locale: resolveLocale('system'),
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zh, en }
})

/**
 * 脚本/Store 里用的类型化翻译：键必须是词典里存在的，
 * 弥补 $t 在模板中无键校验的空档（拼错键在编译期就会报错）。
 */
export function t(key: MsgKey, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {})
}

/** 当前生效语言（渲染层）；主进程侧另有同名同步机制 */
export function currentLocale(): 'zh-CN' | 'en' {
  return i18n.global.locale.value
}

/** 应用语言偏好：更新渲染层并通知主进程（菜单/托盘/系统对话框） */
export async function applyLocalePref(pref: LocalePref): Promise<void> {
  i18n.global.locale.value = resolveLocale(pref)
  await window.api.app.setLocale(pref)
}
