import type { AppConfig } from '@shared/types'
import { processThemeCss } from './theme-css'

/** M3 外观扩展：外部 CSS 主题注入 + 字体族令牌 + 全局自定义 CSS。
 *  主题 CSS 的兼容处理（@import/url 重写/作用域/变量桥）在 services/theme-css.ts。
 *  ui.applyConfig / 配置广播 / 用户样式变更时调用 applyAppearanceConfig。 */

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

function applyThemeCss(payload: string): void {
  ensureStyle(THEME_STYLE_ID).textContent = payload
}

function applyUserCss(css: string): void {
  ensureStyle(USER_STYLE_ID).textContent = css
}

/** 字体族：文档内容用 --font-body（默认回落 --font-ui），代码回落 --font-code。
 *  设空串清除覆盖，回到 base.css 默认值；主题 :root 里定义同名变量会被
 *  这里的行内样式压过（用户显式设置优先） */
function applyFonts(bodyFont: string, codeFont: string): void {
  const root = document.documentElement.style
  if (bodyFont.trim()) root.setProperty('--font-body', bodyFont)
  else root.removeProperty('--font-body')
  if (codeFont.trim()) root.setProperty('--font-code', codeFont)
  else root.removeProperty('--font-code')
}

/** 把主题真实底色同步给主进程做窗口背景：resize/切换瞬间不闪默认浅色 */
function reportWindowBackground(): void {
  const m = getComputedStyle(document.body).backgroundColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return
  const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  window.api.app.setThemeBackground(hex)
}

/** 主题应用序号：主题 CSS 处理是异步的（@import 内联/远程字体），连续切换主题时
 *  先发起的旧任务可能后完成，把新主题覆盖回旧样式——完成时序号不符即丢弃 */
let applySeq = 0

/** 应用外观配置（主题文件被删/改名时静默回内置主题） */
export async function applyAppearanceConfig(cfg: { appearance?: AppConfig['appearance'] }): Promise<void> {
  const seq = ++applySeq
  const a = cfg.appearance ?? {}
  const payload = await processThemeCss(a.themeCss ?? '', 'preview', undefined, a.themeVariant)
  const user = await window.api.theme.readUserCss()
  if (seq !== applySeq) return
  applyThemeCss(payload)
  // 主题生效标记：内置样式据此让出代码块 chrome（Typora 没有语言栏/复制栏）
  if (payload) document.documentElement.dataset.themeCss = 'custom'
  else delete document.documentElement.dataset.themeCss
  applyUserCss(user)
  applyFonts(a.bodyFont ?? '', a.codeFont ?? '')
  reportWindowBackground()
}

/** 用户样式表被外部修改后重读注入（主题与字体不动） */
export async function refreshUserCss(): Promise<void> {
  applyUserCss(await window.api.theme.readUserCss())
}

/** 导出（PDF/HTML/PNG）注入用：主题 CSS（按导出明暗选变体）+ 用户 CSS */
export async function exportExtraCss(theme?: 'light' | 'dark'): Promise<string> {
  const cfg = await window.api.app.getConfig()
  let css = await processThemeCss(
    cfg.appearance?.themeCss ?? '',
    'export',
    theme,
    cfg.appearance?.themeVariant
  )
  const user = await window.api.theme.readUserCss()
  if (user) css += (css ? '\n' : '') + user
  return css
}
