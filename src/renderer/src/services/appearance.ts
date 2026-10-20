import type { AppConfig } from '@shared/types'

/** M3 外观扩展：外部 CSS 主题注入 + 字体族令牌 + 全局自定义 CSS。
 *  ui.applyConfig / 配置广播 / 用户样式变更时调用 applyAppearance。 */

const THEME_STYLE_ID = 'inkbox-theme-css'
const USER_STYLE_ID = 'inkbox-user-css'

function ensureStyle(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  return el
}

/** 常见 Typora 主题变量 → Inkbox 设计令牌映射：社区主题近零成本移植。
 *  扫描主题 CSS 里这些变量的定义值，生成 :root 覆盖块追加在主题 CSS 之后。 */
const TYPORA_MAP: [typora: string, inkbox: string][] = [
  ['--bg-color', '--bg'],
  ['--side-bar-bg-color', '--bg-rail'],
  ['--text-color', '--text'],
  ['--primary-color', '--accent'],
  ['--primary-color-dark', '--accent-strong'],
  ['--a-color', '--accent-strong'],
  ['--link-color', '--accent-strong'],
  ['--code-bg-color', '--code-bg'],
  ['--border-color', '--border'],
  ['--control-text-color', '--text-2'],
  ['--raw-block-color', '--surface-2'],
  ['--selection-color', '--selection'],
  ['--mark-color', '--accent-soft']
]

/** 提取主题里已定义的 Typora 变量值，翻译成 Inkbox 令牌覆盖块 */
export function typoraTokenBridge(css: string): string {
  const rules: string[] = []
  for (const [from, to] of TYPORA_MAP) {
    const m = css.match(new RegExp(`${from.replace(/-/g, '\\-')}\\s*:\\s*([^;}]+)`))
    if (m) rules.push(`${to}: ${m[1].trim()};`)
  }
  return rules.length ? `\n/* Typora 变量映射 */\n:root { ${rules.join(' ')} }\n` : ''
}

/** 主题 CSS（含 Typora 变量映射）：应用内注入与导出共用 */
export function themeCssPayload(css: string): string {
  return css ? css + typoraTokenBridge(css) : ''
}

function applyThemeCss(payload: string): void {
  ensureStyle(THEME_STYLE_ID).textContent = payload
}

function applyUserCss(css: string): void {
  ensureStyle(USER_STYLE_ID).textContent = css
}

/** 字体族：文档内容用 --font-body（默认回落 --font-ui），代码回落 --font-code。
 *  设空串清除覆盖，回到 base.css 默认值 */
function applyFonts(bodyFont: string, codeFont: string): void {
  const root = document.documentElement.style
  if (bodyFont.trim()) root.setProperty('--font-body', bodyFont)
  else root.removeProperty('--font-body')
  if (codeFont.trim()) root.setProperty('--font-code', codeFont)
  else root.removeProperty('--font-code')
}

async function themePayload(file: string): Promise<string> {
  if (!file) return ''
  const css = await window.api.theme.readCss(`${file}.css`)
  return css ? themeCssPayload(css) : ''
}

function appearanceOf(cfg: AppConfig): { themeCss: string; bodyFont: string; codeFont: string } {
  const a = cfg.appearance ?? {}
  return { themeCss: a.themeCss ?? '', bodyFont: a.bodyFont ?? '', codeFont: a.codeFont ?? '' }
}

/** 应用外观配置（主题文件被删/改名时静默回内置主题） */
export async function applyAppearanceConfig(cfg: AppConfig): Promise<void> {
  const { themeCss, bodyFont, codeFont } = appearanceOf(cfg)
  applyThemeCss(await themePayload(themeCss))
  applyUserCss(await window.api.theme.readUserCss())
  applyFonts(bodyFont, codeFont)
}

/** 用户样式表被外部修改后重读注入（主题与字体不动） */
export async function refreshUserCss(): Promise<void> {
  applyUserCss(await window.api.theme.readUserCss())
}

/** 导出（PDF/HTML/PNG）注入用：当前主题 CSS + 用户 CSS（读实时配置） */
export async function exportExtraCss(): Promise<string> {
  const cfg = await window.api.app.getConfig()
  let css = await themePayload(cfg.appearance?.themeCss ?? '')
  const user = await window.api.theme.readUserCss()
  if (user) css += (css ? '\n' : '') + user
  return css
}
