import type { ThemeInfo } from '@shared/types'

/** Typora 主题 CSS 兼容管线（M3 3.1）。
 *
 *  Typora 的做法：整个窗口就是文档，主题 CSS 全局注入，主题用 :root 变量
 *  （--bg-color/--text-color/--primary-color…）+ #write 正文容器 + 相对 url
 *  引用「同名资源文件夹」里的字体图片，@import 拆分文件。
 *
 *  我们不能照搬全局注入（自绘界面会被 body/button/input 等规则污染），管线为：
 *    1. 内联本地 @import（环检测）；远程 @import 保留
 *    2. 相对 url() → theme-resource://t/<路径>（导出模式内联为 data URL）
 *    3. 选择器作用域化：html/body/#write/content → :is(.md-preview,.luci-prose)，
 *       其余裸选择器加该前缀；:root 与 @font-face/@keyframes 原样
 *    4. 双向变量桥：前置别名（主题引用但未定义的变量落回我们的令牌）+
 *       后置取值（主题定义的变量扩散到我们的设计令牌，整个应用跟主题走） */

/** 内容容器作用域。类名重复三遍是为了把特异性抬到 (0,3,x)：
 *  主题规则必须压过内置内容样式——dev 下 Vite 可能在主题 style 之后才注入
 *  组件 CSS（如 wysiwyg.css 的 .wysiwyg-host .luci-prose pre），同特异性会让
 *  主题的表格/代码样式被内置样式盖掉（sonnet 实测）。 */
const SCOPE = ':is(.md-preview.md-preview.md-preview, .luci-prose.luci-prose.luci-prose)'

/* ---------- 相对路径工具 ---------- */

function dirnameOf(file: string): string {
  const i = file.lastIndexOf('/')
  return i < 0 ? '' : file.slice(0, i)
}

/** 以 dir 为基准解析相对路径（不请求文件系统，纯字符串归一） */
function resolveRel(dir: string, rel: string): string {
  const raw = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = (dir ? dir.split('/') : [])
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

function encodeRelPath(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/')
}

/* ---------- 1. 内联 @import ---------- */

async function inlineImports(file: string, seen: Set<string>, depth: number): Promise<string> {
  if (depth > 6 || seen.has(file)) return ''
  seen.add(file)
  const css = await window.api.theme.readCss(file)
  if (css === null) return ''
  const dir = dirnameOf(file)
  const jobs: Promise<string>[] = []
  const out = css.replace(
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*[^;]*;/g,
    (whole, _q1, u1, _q2, u2) => {
      const target = (u1 ?? u2) as string | undefined
      if (!target) return whole
      if (/^(https?:)?\/\//i.test(target) || /^data:/i.test(target)) return whole // 远程/内联保留
      const rel = resolveRel(dir, target)
      if (!rel.toLowerCase().endsWith('.css')) return whole
      const idx = jobs.length
      jobs.push(inlineImports(rel, seen, depth + 1))
      return `\u0000IMPORT${idx}\u0000`
    }
  )
  const inlined = await Promise.all(jobs)
  return out.replace(/\u0000IMPORT(\d+)\u0000/g, (_, i) => `\n/* inlined @import */\n${inlined[Number(i)]}\n`)
}

/* ---------- 2. url() 重写 ---------- */

const SKIP_URL = /^(data:|https?:|\/\/|#|about:)/i

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    }
    const mime = res.headers.get('content-type') ?? 'application/octet-stream'
    return `data:${mime};base64,${btoa(bin)}`
  } catch {
    return null
  }
}

/** 重写本地相对 url()；preview → 协议 URL，export → data URL 内联（打印页无协议上下文风险） */
async function rewriteUrls(css: string, dir: string, mode: 'preview' | 'export'): Promise<string> {
  const jobs: Promise<string | null>[] = []
  const replaced = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q, raw) => {
    const val = raw.trim()
    if (!val || SKIP_URL.test(val)) return whole
    const rel = resolveRel(dir, val)
    if (!rel) return whole
    const url = `theme-resource://t/${encodeRelPath(rel)}`
    if (mode === 'preview') return `url('${url}')`
    const idx = jobs.length
    jobs.push(toDataUrl(url))
    return `\u0000URL${idx}\u0000`
  })
  if (jobs.length === 0) return replaced
  const datas = await Promise.all(jobs)
  return replaced.replace(/\u0000URL(\d+)\u0000/g, (_, i) => {
    const d = datas[Number(i)]
    return d ? `url('${d}')` : "url('')"
  })
}

/* ---------- 3. 选择器作用域化 ---------- */

/** 把注释替换成占位符，处理完再还原（版权头等注释要保留） */
function protectComments(css: string): { text: string; restore: (s: string) => string } {
  const kept: string[] = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    kept.push(m)
    return `\u0000C${kept.length - 1}\u0000`
  })
  return { text, restore: (s) => s.replace(/\u0000C(\d+)\u0000/g, (_, i) => kept[Number(i)]) }
}

/** 单个选择器 → 作用域化。
 *  选择器里的注释（如 `/*核心变量*​/ :root`）直接剥掉再判定，否则占位符
 *  会破坏 :root/前缀判定，产出永远匹配不到的选择器。
 *  :root 也作用域化：主题常在里面重定义 --font-ui/--font-mono，全局注入会
 *  把应用界面字体一起改掉；限制在内容容器后变量仍向内容后代继承，
 *  应用级配色另由 typoraValueBridge 映射。 */
function scopeSelector(sel: string): string {
  let s = sel.replace(/\u0000C\d+\u0000/g, '').trim()
  if (!s) return s
  // 状态前缀（:root[data-theme='dark'] / [data-theme='dark']）：记录在 <html>
  // 上的属性，作用域化后必须保留在根节点侧，内容容器挂在它后面
  let statePrefix = ''
  const stateMatch = s.match(/^(:root)?(\[[^\]]*data-theme[^\]]*\])([\s>+~]*)/i)
  if (stateMatch) {
    statePrefix = `:root${stateMatch[2]}`
    s = s.slice(stateMatch[0].length).trim()
    if (!s) return `${statePrefix} ${SCOPE}`
  }
  // :root / html / body / #write / content / .write（Typora 正文容器别名）→ SCOPE；
  // .md-fences（Typora 代码块）→ pre（我们的代码块同样是 pre 元素）；
  // .CodeMirror-lines 是 Typora 围栏内层（字号/行高/字族），映射到 pre code
  const out = s
    .replace(
      /(^|[\s>+~(])(:root|html|body|content|#write|\.write)(?![\w-])/gi,
      (_m, pre) => `${pre}${SCOPE}`
    )
    // pre.md-fences 复合写法先剥类（night 等官方主题），再于通用替换兜底——
    // 否则 `.md-fences → pre` 会产出非法的 prepre，整条规则作废（底色丢失）。
    // 两处都排除 md-meta-block：裸 pre/类映射不能命中 front matter（nord 的
    // .md-fences 底色在 Typora 里不会染到元信息块，这里同样不能）
    .replace(/(^|[\s>+~(])pre\.md-fences(?![\w-])/gi, '$1pre:not(.md-meta-block)')
    .replace(/\.md-fences(?![\w-])/gi, 'pre:not(.md-meta-block)')
    .replace(/\.CodeMirror-lines(?![\w-])/gi, 'code')
    // Typora 惯用内部类 → 我们预览/即显两侧 DOM 都命中的等价物
    .replace(/\.md-table(?![\w-])/gi, 'table')
    .replace(/\.md-footnote(?![\w-])/gi, '.footnote-ref')
    .replace(
      /\.md-task-list-item(?![\w-])/gi,
      ":is(li.task-list-item, li[data-item-type='task'])"
    )
  const scoped = (() => {
    const scopePat = SCOPE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const onlyScope = new RegExp(`^${scopePat}([\\s>+~]+${scopePat})*$`, 'i')
    const t = out.trim()
    if (onlyScope.test(t)) return SCOPE.trim()
    if (t.startsWith(SCOPE) || t.startsWith(':root') || t.startsWith('[')) return t
    return `${SCOPE} ${t}`
  })()
  // .md-fences 的装饰性伪元素（orangeheart 的 mac 圆点条、语言徽标等）依赖
  // CodeMirror 包装 DOM，直接叠到普通 pre 上会盖住首行代码——丢弃
  if (/::?(before|after)\s*$/i.test(s.trim())) {
    const stripped = scoped.replace(/::?(before|after)\s*$/i, '').trim()
    if (stripped === 'pre:not(.md-meta-block)' || stripped.endsWith(' pre:not(.md-meta-block)')) {
      return ''
    }
  }
  return statePrefix ? `${statePrefix} ${scoped}` : scoped
}

/** 顶层逗号切分（忽略 :is()/:not() 等括号内逗号） */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts
}

/** 选择器列表（顶层逗号切分）逐个作用域化 */
function scopeSelectorList(list: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of splitTopLevel(list)) {
    const t = scopeSelector(p).trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out.join(', ')
}

/** 只对「选择器主体就是页面/正文容器本身」的规则做声明让位。
 *  #write p / .write th 这类后代规则必须原样保留——否则主题的段落缩进、
 *  表格单元格 padding、表头边框会被一起删掉（sonnet 实测：整张表退化成
 *  内置样式）。混合列表（容器 + 后代）按保守处理：保留声明。 */
function allContainerSubjects(head: string): boolean {
  const parts = splitTopLevel(head)
    .map((p) => p.replace(/\u0000C\d+\u0000/g, '').trim())
    .filter(Boolean)
  if (parts.length === 0) return false
  return parts.every((p) => {
    const last = p.split(/[\s>+~]+/).filter(Boolean).pop() ?? ''
    return /^(?::root|html|body|#write|\.write|content)(?:\[[^\]]*\])?$/.test(last)
  })
}

/** 丢弃页面级/容器级的有害声明：
 *  - margin/padding：html/body 的页面留白会把容器内边距清零
 *  - display/flex/gap：Typora 用 #write{display:flex;gap} 排版，套到我们的
 *    容器会破坏块级流（空行占位/表格包装器/前置元数据块全部变形）
 *  - background(-color/-image)：页面底色已由令牌桥接管；容器再叠主题页面底色
 *    会在纸卡上出现「内容列 + 两侧异色竖带」（sonnet 实测） */
function stripContainerDecls(body: string): string {
  return body
    .replace(/(^|[;{\n])\s*(margin|padding)(?:-(?:top|right|bottom|left))?\s*:[^;}]*;?/gi, '$1')
    .replace(
      /(^|[;{\n])\s*(display|gap|row-gap|column-gap|flex(?:-(?:direction|wrap|flow|grow|shrink|basis))?)\s*:[^;}]*;?/gi,
      '$1'
    )
    .replace(/(^|[;{\n])\s*background(?:-color|-image)?\s*:[^;}]*;?/gi, '$1')
}

/** 遍历块结构做作用域化；@font-face/@keyframes 等原样，@media/@supports 递归 */
function scopeBlocks(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) {
      out += css.slice(i)
      break
    }
    const head = css.slice(i, open)
    const openHead = head.lastIndexOf(';')
    const headPart = openHead >= 0 ? head.slice(openHead + 1) : head
    // 找配对右括号（主题 CSS 里普通规则体不会再嵌套 {}，@media 会——统一计数）
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    // head 里可能残留前一条无块语句（@import/@charset 的 ;）：前缀原样保留
    const headPrefix = openHead >= 0 ? head.slice(0, openHead + 1) : ''
    const at = headPart.trim().match(/^@([\w-]+)/)
    if (at) {
      const name = at[1].toLowerCase()
      if (name === 'media' || name === 'supports' || name === 'container' || name === 'layer' || name === 'scope') {
        out += headPrefix + headPart + '{' + scopeBlocks(body) + '}'
      } else {
        out += headPrefix + headPart + '{' + body + '}' // @font-face/@keyframes/@property 等原样
      }
    } else {
      // 容器本身（html/body/#write/:root/.write）的页面盒模型/布局/底色声明让位；
      // 后代规则（#write p、.write th…）原样保留
      const isContainer = allContainerSubjects(headPart)
      const decls = isContainer ? stripContainerDecls(body) : body
      const scopedSel = scopeSelectorList(headPart.trim())
      if (!scopedSel.trim()) {
        // 选择器整体被丢弃（如 .md-fences 的装饰性 ::before/::after）
        out += headPrefix
      } else {
        out += headPrefix + scopedSel + ' {' + decls + '}'
      }
    }
    i = j
  }
  return out
}

function scopeThemeCss(css: string): string {
  const { text, restore } = protectComments(css)
  return restore(scopeBlocks(text))
}

/* ---------- 3.5 rem 基准换算 ---------- */

/** 主题根字号（rem 基准）：顶层 html/:root 规则里的 font-size（px）。
 *  作用域化后 html 规则不再作用于真实根元素，而 rem 永远按真实根解析——
 *  blubook（14px）/ nord（18px）这类改根字号的主题，全部 rem 字号会整体
 *  偏大/偏小 12–14%。这里读出主题想要的基准，由 convertRem 把 rem 换算成
 *  等值 px（基准 16px 的主题是恒等变换，不做替换）。
 *  @media 内的 html font-size（如 vue 打印时 13px）不改屏幕 rem 基准，跳过。 */
function themeRootFontSize(css: string): number | null {
  let root: number | null = null
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const headStart = Math.max(css.lastIndexOf('}', open), css.lastIndexOf(';', open)) + 1
    const head = css.slice(headStart, open).trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    if (!head.startsWith('@') && /(^|[\s,>+~])(html|:root)(?![\w-])/i.test(head)) {
      const m = body.match(/(?:^|;)\s*font-size\s*:\s*(\d*\.?\d+)px/i)
      if (m) root = Number(m[1]) // 同文件多条 html 字号规则按级联取最后一条
    }
    i = j
  }
  return root
}

/** rem → px 换算（含变量定义值与 calc 内的 rem；url() 里带数字 rem 的文件名
 *  属天文数字级别的巧合，不设防） */
function convertRem(css: string, rootPx: number): string {
  if (!rootPx || Math.abs(rootPx - 16) < 0.01) return css
  return css.replace(/(-?\d*\.?\d+)rem\b/gi, (_m, n: string) => {
    const px = Number(n) * rootPx
    return `${Math.round(px * 100) / 100}px`
  })
}

/* ---------- 4. 双向变量桥 ---------- */

/** 应用自身的设计令牌（M3）：主题定义了同名变量时原样接管 */
const APP_TOKENS = [
  '--bg',
  '--bg-rail',
  '--surface',
  '--surface-2',
  '--border',
  '--text',
  '--text-2',
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--selection',
  '--danger',
  '--ok',
  '--code-bg',
  '--code-bar',
  '--code-fg',
  '--code-edge',
  '--code-comment',
  '--code-keyword',
  '--code-string',
  '--code-number',
  '--code-title',
  '--code-attr',
  '--code-type',
  '--code-deletion',
  '--inline-code-bg',
  '--inline-code-fg',
  '--inline-code-border'
]

const CODE_TOKENS = [
  '--code-bg',
  '--code-bar',
  '--code-fg',
  '--code-edge',
  '--code-comment',
  '--code-keyword',
  '--code-string',
  '--code-number',
  '--code-title',
  '--code-attr',
  '--code-type',
  '--code-deletion'
]

/** 需要做可读性兜底的语法前景令牌（背景/描边类不参与） */
const SYNTAX_TOKENS = [
  '--code-fg',
  '--code-comment',
  '--code-keyword',
  '--code-string',
  '--code-number',
  '--code-title',
  '--code-attr',
  '--code-type',
  '--code-deletion'
]

/** 明暗兜底令牌：主题只给了主色时，代码块/图标/危险色等仍要跟主题明暗一致。
 *  值与 base.css 的双主题调色板对齐（主题自己定义的同名令牌优先） */
const POLARITY_LIGHT: Record<string, string> = {
  '--bg': '#f6f2ec',
  '--bg-rail': '#ece4d7',
  '--surface': '#ffffff',
  '--surface-2': '#efe9e0',
  '--border': '#e4dcd0',
  '--text': '#2b2420',
  '--text-2': '#7c7267',
  '--accent': '#c9701f',
  '--accent-strong': '#b16014',
  '--accent-soft': 'rgba(201, 112, 31, 0.12)',
  '--selection': 'rgba(58, 118, 190, 0.5)',
  '--danger': '#c2503e',
  '--ok': '#2e7f72',
  '--shadow-card': '0 1px 3px rgba(38, 32, 25, 0.06), 0 10px 28px rgba(38, 32, 25, 0.06)',
  '--shadow-pop': '0 2px 6px rgba(38, 32, 25, 0.08), 0 16px 40px rgba(38, 32, 25, 0.12)',
  '--code-bg': '#f2ecdf',
  '--code-bar': '#eae2d2',
  '--code-fg': '#2b2420',
  '--code-edge': 'rgba(38, 32, 25, 0.08)',
  '--code-comment': '#9c9184',
  '--code-keyword': '#b16014',
  '--code-string': '#57783b',
  '--code-number': '#b8503f',
  '--code-title': '#3565a3',
  '--code-attr': '#8a6d2f',
  '--code-type': '#7a55c0',
  '--code-deletion': '#c2503e'
}

const POLARITY_DARK: Record<string, string> = {
  '--bg': '#1d1814',
  '--bg-rail': '#14100c',
  '--surface': '#272019',
  '--surface-2': '#332a21',
  '--border': '#3b3128',
  '--text': '#eae2d6',
  '--text-2': '#a89d8e',
  '--accent': '#e6a054',
  '--accent-strong': '#f0b26e',
  '--accent-soft': 'rgba(230, 160, 84, 0.14)',
  '--selection': 'rgba(124, 170, 222, 0.55)',
  '--danger': '#d66a55',
  '--ok': '#5bb8a8',
  '--shadow-card': '0 1px 3px rgba(0, 0, 0, 0.25), 0 10px 28px rgba(0, 0, 0, 0.22)',
  '--shadow-pop': '0 2px 6px rgba(0, 0, 0, 0.3), 0 16px 40px rgba(0, 0, 0, 0.4)',
  '--code-bg': '#26201a',
  '--code-bar': '#1d1812',
  '--code-fg': '#ece4d8',
  '--code-edge': 'rgba(255, 244, 230, 0.16)',
  '--code-comment': '#8a7f70',
  '--code-keyword': '#f4c67f',
  '--code-string': '#a8c98a',
  '--code-number': '#e8a3a0',
  '--code-title': '#9fc6e8',
  '--code-attr': '#d4b483',
  '--code-type': '#c9b3f0',
  '--code-deletion': '#d66a55'
}

/** 后置取值桥：主题定义的 Typora 变量值 → 我们的设计令牌（整应用跟随主题） */
const VALUE_BRIDGE: [typora: string, inkbox: string][] = [
  ['--bg-color', '--bg'],
  ['--side-bar-bg-color', '--bg-rail'],
  ['--window-bg-color', '--bg'],
  ['--text-color', '--text'],
  ['--control-text-color', '--text-2'],
  ['--primary-color', '--accent'],
  ['--accent-color', '--accent'],
  ['--primary-color-dark', '--accent-strong'],
  ['--a-color', '--accent-strong'],
  ['--link-color', '--accent-strong'],
  ['--link-hover-color', '--accent-strong'],
  // sonnet：围栏代码块用 --pre-bg-color（半透明白），--code-bg-color 是行内代码的淡染；
  // 块底色优先取 --pre-bg-color（存在时），行内底色始终取 --code-bg-color
  ['--pre-bg-color', '--code-bg'],
  ['--code-bg-color', '--code-bg'],
  ['--code-bg-color', '--inline-code-bg'],
  ['--code-border', '--inline-code-border'],
  ['--surface-code', '--code-bg'],
  ['--code-text-color', '--code-fg'],
  ['--code-text', '--code-fg'],
  ['--code-border-color', '--code-edge'],
  ['--code-border', '--code-edge'],
  ['--code-toolbar', '--code-bar'],
  // sonnet 等主题的自有命名
  ['--font-color', '--text'],
  ['--pre-border-color', '--code-edge'],
  ['--pre-inputfont-color', '--code-fg'],
  ['--code-font-color', '--inline-code-fg'],
  ['--code-muted-color', '--code-comment'],
  ['--code-comment-color', '--code-comment'],
  ['--code-muted', '--code-comment'],
  ['--code-keyword-color', '--code-keyword'],
  ['--code-string-color', '--code-string'],
  ['--code-number-color', '--code-number'],
  ['--code-symbol-color', '--code-attr'],
  ['--code-operator', '--code-attr'],
  ['--code-property', '--code-title'],
  ['--code-variable', '--code-fg'],
  ['--code-tag', '--code-keyword'],
  ['--code-type-color', '--code-type'],
  ['--bg-inline-code', '--inline-code-bg'],
  ['--inline-code-bg', '--inline-code-bg'],
  ['--inline-code-bg-color', '--inline-code-bg'],
  ['--inline-code-color', '--inline-code-fg'],
  ['--inline-code-text', '--inline-code-fg'],
  ['--inline-code-border-color', '--inline-code-border'],
  ['--border-color', '--border'],
  ['--select-text-bg-color', '--selection'],
  ['--selection-color', '--selection'],
  // 应用令牌同名直通（esther / lightmind 这类主题直接用了我们的命名）
  ...APP_TOKENS.map((t) => [t, t] as [string, string])
]

/** 颜色解析：返回 [r, g, b, a]（a 缺省 1）。无法解析返回 null */
function parseColor(v: string): [number, number, number, number] | null {
  const s = v.trim()
  const hex = s.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 4) {
      const rgb = [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16))
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1
      return [rgb[0], rgb[1], rgb[2], a]
    }
    if (h.length >= 6) {
      const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      return [rgb[0], rgb[1], rgb[2], a]
    }
  }
  const rgb = s.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const p = rgb[1].split(/[,\s/]+/).map(Number)
    if (p.length >= 3 && p.slice(0, 3).every((n) => Number.isFinite(n))) {
      const a = p.length >= 4 && Number.isFinite(p[3]) ? p[3] : 1
      return [p[0], p[1], p[2], a]
    }
  }
  return null
}

/** 半透明色在底色上的合成结果（backdrop 须为不透明） */
function compositeOver(v: string, backdrop: [number, number, number, number]): [number, number, number, number] | null {
  const c = parseColor(v)
  if (!c) return null
  if (c[3] >= 1) return c
  return [
    c[0] * c[3] + backdrop[0] * (1 - c[3]),
    c[1] * c[3] + backdrop[1] * (1 - c[3]),
    c[2] * c[3] + backdrop[2] * (1 - c[3]),
    1
  ]
}

function isLightColor(v: string, backdrop?: string): boolean {
  const bd = (backdrop && parseColor(backdrop)) || [255, 255, 255, 1]
  const c = compositeOver(v, bd as [number, number, number, number])
  if (!c) return true
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.5
}

/** WCAG 相对亮度（只用于判定「语法色在代码底上还能不能看清」） */
function relativeLuminance(c: [number, number, number]): number {
  const [r, g, b] = c.map((x) => {
    const s = x / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Typora 的代码块语法色大多走 CodeMirror 类名（.cm-keyword 等）而不是
 *  --code-* 变量；把主题里 .cm-* 规则的颜色提取到我们的高亮令牌（缺席才补），
 *  高亮观感才能与 Typora 一致（sonnet 实测：紫关键字/绿字符串/红属性）。 */
const CM_TOKEN_MAP: [RegExp, string][] = [
  [/^comment$|^meta$/, '--code-comment'],
  [/^keyword$|^builtin$/, '--code-keyword'],
  [/^string$|^string-2$/, '--code-string'],
  [/^number$|^atom$/, '--code-number'],
  [/^attribute$|^property$|^qualifier$|^link$/, '--code-attr'],
  [/^def$/, '--code-type'],
  [/^tag$/, '--code-keyword'],
  [/^header$/, '--code-title'],
  [/^variable$|^operator$|^bracket$/, '--code-fg']
]

function extractCmTokenColors(css: string, set: Map<string, string>, defs: Map<string, string>): void {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]
    // Typora 源码模式调色板（.cm-s-typora-default / #typora-source）不是内容
    // 围栏的配色（blubook 内嵌了一套 Source Code Pro 绿字调色板，混进来会把
    // 围栏前景染成源码模式的绿），一律排除
    if (/cm-s-typora-default|typora-source|#typora-/.test(sel)) continue
    const cmHits = [...sel.matchAll(/\.cm-([\w-]+)/g)]
    if (cmHits.length === 0) continue
    const colorHit = m[2].match(/(?:^|;)\s*color\s*:\s*([^;!}]+)/i)
    if (!colorHit) continue
    // 一条规则常带多个 cm 类（.cm-tag,.cm-attribute,.cm-property{...}），逐个尝试
    for (const cm of cmHits) {
      for (const [re, token] of CM_TOKEN_MAP) {
        if (!re.test(cm[1]) || set.has(token)) continue
        let v = colorHit[1].replace(/!important/i, '').trim()
        if (/^var\(/i.test(v)) {
          const inner = defs.get(v.slice(4, -1).trim())
          if (!inner) continue
          v = inner
        }
        if (parseColor(v)) set.set(token, v)
        break
      }
    }
  }
}

/** CodeMirror 包装层的围栏外形：blubook 等主题把代码块底色/前景/圆角写在
 *  .cm-s-inner.CodeMirror（或裸 .CodeMirror / -gutters）上而不是 .md-fences，
 *  不提取会出现「深藏青代码块变白底」的重大观感偏差。仅在对应令牌缺席时兜底，
 *  排除 Typora 源码模式（#typora-source 等）的编辑器规则。 */
function extractCmWrapperStyle(css: string, set: Map<string, string>, defs: Map<string, string>): void {
  const resolve = (v: string): string | null => {
    let out = v.replace(/!important/i, '').trim()
    if (/^var\(/i.test(out)) {
      const inner = defs.get(out.slice(4, -1).trim())
      if (!inner) return null
      out = inner.trim()
    }
    return out || null
  }
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]
    if (/cm-s-typora-default|#[\w-]*source|#typora-|\.typora-/.test(sel)) continue
    // .CodeMirror-lines/.CodeMirror-selected 等由别的通道处理，不算包装层
    if (!/\.cm-s-inner|\.CodeMirror(?![\w-])/.test(sel)) continue
    const pick = (re: RegExp): string | null => {
      const hit = m[2].match(re)
      return hit ? resolve(hit[1]) : null
    }
    const bg = pick(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;!}]+)/i)
    if (bg && parseColor(bg) && !set.has('--code-bg')) set.set('--code-bg', bg)
    const fg = pick(/(?:^|;)\s*color\s*:\s*([^;!}]+)/i)
    if (fg && parseColor(fg) && !set.has('--code-fg')) set.set('--code-fg', fg)
    const radius = pick(/(?:^|;)\s*border-radius\s*:\s*([^;!}]+)/i)
    if (radius && !set.has('--code-radius')) set.set('--code-radius', radius)
  }
}

export function typoraValueBridge(css: string): string {
  // 主题里全部变量定义（首现优先）：桥接值为 var() 引用时就地解析，
  // 解析不到（变量定义在非全局选择器上）就跳过该条，绝不能把未定义引用
  // 写进我们的令牌（会把 --bg 变成空值，整应用丢底色）
  const defs = new Map<string, string>()
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    if (!defs.has(m[1])) defs.set(m[1], m[2].trim())
  }
  const resolve = (value: string, depth = 0): string | null => {
    const v = value.trim()
    if (!v) return null
    if (!/^var\(--[\w-]+\)$/i.test(v)) return v
    if (depth >= 4) return null
    const inner = defs.get(v.slice(4, -1).trim())
    return inner ? resolve(inner, depth + 1) : null
  }
  const valueOf = (name: string): string | null => {
    const raw = defs.get(name)
    return raw === undefined ? null : resolve(raw)
  }

  const set = new Map<string, string>()
  // CodeMirror 语法色提取先行：Typora 渲染代码就是 CodeMirror，cm 规则的颜色
  // 才是用户实际看到的（sonnet 的 --pre-inputfont-color 只是编辑输入态色）；
  // 直接定义 --code-* 变量的主题不受影响（cm 规则引用同名变量时解析结果一致）
  extractCmTokenColors(css, set, defs)
  // 包装层外形其次（blubook 把围栏底色/圆角写在 .cm-s-inner.CodeMirror 上，
  // 这才是 Typora 里实际可见的盒子），.md-fences 的底色作缺席兜底
  extractCmWrapperStyle(css, set, defs)
  // 围栏代码块的外形参数：Typora 由 .md-fences 的圆角、底色，.CodeMirror-lines
  // 的字号定义，我们没有等价类名（.md-fences → pre 只带声明），提取成令牌供
  // 主题模式复位使用
  for (const m of css.matchAll(/\.md-fences(?![\w-])[^{}]*\{([^}]*)\}/gi)) {
    if (!set.has('--code-bg')) {
      const bg = m[1].match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;}]+)/i)
      const v = bg?.[1].replace(/!important/i, '').trim()
      if (v && parseColor(v)) set.set('--code-bg', v)
    }
    const r = m[1].match(/border-radius\s*:\s*([^;}]+)/i)
    if (r) {
      set.set('--code-radius', r[1].replace(/!important/i, '').trim())
      break
    }
  }
  const linesRule = css.match(/\.CodeMirror-lines(?![\w-])[^{}]*\{([^}]*)\}/i)
  const linesFont = linesRule?.[1].match(/font-size\s*:\s*([^;}]+)/i)
  if (linesFont) set.set('--code-font-size', linesFont[1].replace(/!important/i, '').trim())
  for (const [from, to] of VALUE_BRIDGE) {
    if (set.has(to)) continue // 前面的映射优先级更高
    const v = valueOf(from)
    if (v) set.set(to, v)
  }

  // 派生缺失的表面令牌：主题只给 bg/text 时，卡片/表头/边框也要跟着明暗走，
  // 否则「浅色主题 + 应用深色模式」会出现深色表头配浅色正文（Typora 是整窗换肤）
  // 页面底/前景兜底：nord 这类主题用 --bg-color1 + body{background} 而非标准
  // 变量名——从 body/html 规则声明里取值（var() 引用就地解析），整应用皮肤才能跟随
  const bodyBg = (() => {
    const m = css.match(
      /(?:^|[}\n])\s*(?:html[\s,]*)?body\b[^{}]*\{[^}]*?background(?:-color)?\s*:\s*([^;}]+)/i
    )
    const v = m ? resolve(m[1]) : null
    return v && parseColor(v) ? v : null
  })()
  const bodyFg = (() => {
    const m = css.match(/(?:^|[}\n])\s*(?:html[\s,]*)?body\b[^{}]*\{[^}]*?(?:^|[;{])\s*color\s*:\s*([^;}]+)/i)
    const v = m ? resolve(m[1]) : null
    return v && parseColor(v) ? v : null
  })()
  const bg = set.get('--bg') ?? valueOf('--bg-color') ?? bodyBg
  const text = set.get('--text') ?? valueOf('--text-color') ?? bodyFg
  const light = bg ? isLightColor(bg) : true
  const mix = (color: string, toward: string, pct: number): string =>
    `color-mix(in srgb, ${color} ${pct}%, ${toward})`
  if (bg) {
    const derived: [string, string][] = [
      ['--surface', mix(bg, '#fff', light ? 45 : 92)],
      ['--surface-2', light ? mix(bg, '#000', 92) : mix(bg, '#fff', 88)],
      ['--border', light ? mix(bg, '#000', 86) : mix(bg, '#fff', 82)],
      ['--bg-rail', mix(bg, '#000', 94)]
    ]
    if (text) derived.push(['--text-2', mix(text, bg, light ? 55 : 62)])
    for (const [k, v] of derived) if (!set.has(k)) set.set(k, v)
  }
  // 兜底令牌按主题明暗补齐：危险色/阴影等主题没定义时也必须与主题同一极性；
  // 代码块单独按其自身底色合成到页面底上再判定（sonnet 的代码底是 5% 透明淡染，
  // 直接判亮度会把浅色主题误判成深色代码块 → 浅底配奶白文字，完全看不清）
  const themeSet = new Set(set.keys())
  const codeBgRaw = set.get('--code-bg')
  const codeBgParsed = codeBgRaw ? parseColor(codeBgRaw) : null
  let codeBundle: Record<string, string>
  if (codeBgParsed && codeBgParsed[3] >= 0.5) {
    codeBundle = isLightColor(codeBgRaw as string) ? POLARITY_LIGHT : POLARITY_DARK
  } else {
    codeBundle = light ? POLARITY_LIGHT : POLARITY_DARK
  }
  for (const k of CODE_TOKENS) if (!set.has(k)) set.set(k, codeBundle[k])
  const bundle = light ? POLARITY_LIGHT : POLARITY_DARK
  for (const [k, v] of Object.entries(bundle)) if (!set.has(k)) set.set(k, v)
  // 语法色可读性兜底：主题作者常把浅色变体的 cm-def 颜色原样留在暗色文件里
  // （sonnet-dark 的 #0051c2 在 #262624 上几乎看不见）。能静态解析的颜色在
  // 代码底上对比度低于 2.2 时换用同极性兜底色——宁可色相略偏，也不能看不清
  const pageBgParsed = (parseColor(bg ?? '#ffffff') ?? [255, 255, 255, 1]) as [
    number,
    number,
    number,
    number
  ]
  const codeBg4 = (codeBgRaw && compositeOver(codeBgRaw, pageBgParsed)) || pageBgParsed
  const codeBgTriple: [number, number, number] = [codeBg4[0], codeBg4[1], codeBg4[2]]
  for (const tok of SYNTAX_TOKENS) {
    if (!themeSet.has(tok)) continue
    const raw = set.get(tok)
    if (!raw) continue
    const parsed = parseColor(raw)
    if (!parsed) continue // color-mix()/hsl() 等无法静态判定，交给浏览器
    const over = compositeOver(raw, [codeBgTriple[0], codeBgTriple[1], codeBgTriple[2], 1])
    if (!over) continue
    if (contrastRatio([over[0], over[1], over[2]], codeBgTriple) < 2.2 && codeBundle[tok]) {
      set.set(tok, codeBundle[tok])
    }
  }
  // 代码块顶栏/描边主题通常不单独定义：从代码底色派生，避免「白底代码 + 奶油色顶栏」
  if (codeBgRaw) {
    if (!themeSet.has('--code-bar')) {
      set.set('--code-bar', mix(codeBgRaw, codeBundle === POLARITY_LIGHT ? '#000' : '#fff', 96))
    }
    if (!themeSet.has('--code-edge') && text) {
      set.set('--code-edge', `color-mix(in srgb, ${text} 14%, transparent)`)
    }
  }
  // 侧栏图标随主题前景色走（rail 自身不参与 Typora 变量体系）
  if (text) {
    set.set('--rail-icon', `color-mix(in srgb, ${text} 62%, transparent)`)
    set.set('--rail-hover', `color-mix(in srgb, ${text} 8%, transparent)`)
  }
  const accent = set.get('--accent')
  if (accent) set.set('--rail-icon-hover', accent)

  const rules = [...set].map(([k, v]) => `${k}: ${v};`)
  // color-scheme 跟随主题明暗：内容里的原生控件/滚动条不再按应用模式走
  rules.unshift(`color-scheme: ${light ? 'light' : 'dark'};`)
  // 选择器带上 [data-theme]：特异性高于 base.css 的 [data-theme='dark'] 调色板，
  // 主题配色才能真正接管（对齐 Typora：选主题即整窗换肤）
  return rules.length ? `\n/* Typora 变量 → 应用令牌 */\n:root[data-theme] { ${rules.join(' ')} }\n` : ''
}

/** 前置别名桥：主题引用但未定义的变量回落到我们的令牌（主题自己定义的会覆盖这里） */
const ALIAS_BLOCK = `
/* 应用令牌 → Typora 变量别名（主题未定义的变量回落；主题定义值优先） */
:root {
  --bg-color: var(--bg);
  --side-bar-bg-color: var(--bg-rail);
  --text-color: var(--text);
  --control-text-color: var(--text-2);
  --primary-color: var(--accent);
  --accent-color: var(--accent);
  --primary-color-dark: var(--accent-strong);
  --a-color: var(--accent-strong);
  --link-color: var(--accent-strong);
  --code-bg-color: var(--code-bg);
  --code-text-color: var(--code-fg);
  --border-color: var(--border);
  --select-text-bg-color: var(--selection);
  /* 常被引用但主题常忘定义的：围栏/字体族/内部标记色 */
  --pre-bg-color: var(--code-bg);
  --pre-border-color: var(--code-edge);
  --md-char-color: var(--text-2);
  --meta-content-color: var(--text-2);
  --monospace: var(--font-code);
  --font-main: var(--font-body);
  --sans-serif: var(--font-body);
  --font-sans-serif: var(--font-body);
  --font-monospace: var(--font-code);
}
`

/** 主题接管时的默认样式让位：Typora 主题普遍给 thead（而不是 th）上色，
 *  我们的 th 底色会盖住主题表头（浅底 + 主题给表头的浅色文字 = 看不清） */
const THEME_RESET = `
/* 主题模式：表格默认底色让位（主题的 thead/tr 规则接管） */
${SCOPE} th { background: transparent; }
/* 表格：Typora 的表格默认占满正文宽度、按内容分配列宽（用户手动拖过列宽
   的表格带 data-colwidth，保持固定布局不动）。min-width 防挤压：列总宽超出
   容器时 auto 布局会把「可断行」的列压到一字宽（CJK 内容 min-content 极小），
   抬高列下限让表格溢出交给 md-table-wrap 横向滚动 */
${SCOPE} table:not(:has([data-colwidth])) {
  table-layout: auto;
  width: 100%;
}
${SCOPE} th,
${SCOPE} td {
  min-width: 4em;
}
/* 单元格换行交给主题：内置的 anywhere 会让表格按「最短可断行」压窄列，
   Typora 主题按最长单词定列宽（sonnet 实测 pagingParams 被拆成 pagingParam+s） */
${SCOPE} th,
${SCOPE} td {
  word-break: normal;
  overflow-wrap: break-word;
}
/* 表格单元格里的段落：Typora 的单元格是纯文本，没有 <p>；主题的 #write p
   缩进（sonnet: padding 0 2rem 0 .5rem）套到单元格里会把可用宽度吃掉半截，
   导致 pagingParams 被拆成 pagingParam + s */
${SCOPE} th > p,
${SCOPE} td > p {
  margin: 0;
  padding: 0;
}
/* 主题的行内 code 规则（底色/描边/下划线/红色前景）不许污染围栏代码：
   Typora 里围栏是 CodeMirror 不受 code 选择器影响，我们两者都是 code 元素 */
${SCOPE} pre code {
  background: none;
  border: none;
  text-decoration: none;
  color: inherit;
  font-size: var(--code-font-size, inherit);
}
/* 分割线：内置样式给 hr 限宽 62% 居中（纸面装饰），Typora 主题的 hr 是
   全宽色条——宽度/水平边距约束会让主题 hr「显示不全」；主题自己想画
   短分割线时它的 width/margin 规则在本条之后，照常覆盖 */
${SCOPE} hr {
  width: auto;
  margin-inline: 0;
}
/* 内容字体跟随主题容器（Typora 标题/表头继承 #write 的字族，我们内置 h1/th 写死了 UI 字体） */
${SCOPE} :is(h1, h2, h3, h4, h5, h6, th) {
  font-family: inherit;
}
`

/** 主题样式之后的兜底：Typora 的 #write 由 base 居中（max-width + margin auto），
 *  主题只给 max-width；我们的容器必须补 margin-inline:auto 才能居中（否则内容
 *  列贴左、右侧大片空白，sonnet 实测）。字号/行距保持用户设置优先。
 *  放在主题 CSS 之后是必须的：与主题规则同特异度时靠后即可覆盖（THEME_RESET
 *  在主题之前，只适合主题不会写同选择器的场景）。 */
const CONTENT_FINAL = `
${SCOPE} {
  margin-inline: auto;
  font-size: var(--preview-font-size, 16px);
  line-height: var(--preview-line-height, 1.7);
}
/* Mermaid 图表容器：Typora 里图表不是代码块——主题的 pre/.md-fences 底色
   不能画在图表外壳上（即显侧图表外壳就是 pre.md-mermaid，语言栏留位会
   露出主题 pre 的近黑底色，变成图表上方一道黑带）。内置卡片底/内边距
   一并让位，图表直接落在页面底上，与 Typora 观感一致 */
${SCOPE} :is(.mermaid, .md-mermaid, pre.md-mermaid, .md-mermaid-render) {
  background: transparent;
  border: 0;
  box-shadow: none;
  padding: 0;
}
${SCOPE} .md-mermaid-render {
  margin-top: 0;
}
`

/* ---------- 入口 ---------- */

/** 主题条目：ThemeInfo 已含 name/file/family/variant */
export type ThemeEntry = ThemeInfo

/** 主题键 → 实际文件：
 *  - 同族（base.css + base-dark.css + base-grey.css 这类）按 variant 选择：
 *    指定变体优先，auto 时浅/深跟随应用（或导出）明暗
 *  - 单文件主题/旧配置里的完整文件名直接命中
 *  目录里可能挪动，每次解析现查 */
export async function resolveThemeEntry(
  name: string,
  forceTheme?: 'light' | 'dark',
  variant?: string
): Promise<ThemeEntry | null> {
  if (!name) return null
  const list = await window.api.theme.list()
  const family = list.filter((t) => t.family === name)
  if (family.length > 0) {
    if (variant && variant !== 'auto') {
      const picked = family.find((t) => t.variantKey === variant)
      if (picked) return picked
    }
    const want = forceTheme ?? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    return (
      family.find((t) => t.variant === want) ??
      family.find((t) => t.variant !== 'other') ??
      family[0]
    )
  }
  return list.find((t) => t.name === name) ?? null
}

/** 完整管线：入口主题文件 → 可注入的 CSS（不成功返回空串）。
 *  forceTheme：导出时按导出明暗选变体（PDF 固定浅色），缺省跟随应用；
 *  variant：用户显式指定的变体（auto = 跟随明暗） */
export async function processThemeCss(
  name: string,
  mode: 'preview' | 'export',
  forceTheme?: 'light' | 'dark',
  variant?: string
): Promise<string> {
  const entry = await resolveThemeEntry(name, forceTheme, variant)
  if (!entry) return ''
  const dir = dirnameOf(entry.file)
  let raw = await inlineImports(entry.file, new Set(), 0)
  if (!raw) return ''
  // Typora 私有指令：@include-when-export 只在导出时加载（远程字体）。
  // 应用内剥离（避免误触发网络请求），导出时转成标准 @import
  const exportOnly = /@include-when-export\s+(url\([^)]*\))\s*;?/g
  raw =
    mode === 'export'
      ? raw.replace(exportOnly, '@import $1;')
      : raw.replace(exportOnly, '')
  // 根字号 ≠ 16px 的主题（blubook 14px / nord 18px）：rem 先按主题基准换算成
  // 等值 px，再走作用域化——html 规则已不作用于真实根元素，不换算会整体偏大/偏小
  raw = convertRem(raw, themeRootFontSize(raw) ?? 16)
  const withUrls = await rewriteUrls(raw, dir, mode)
  return ALIAS_BLOCK + THEME_RESET + scopeThemeCss(withUrls) + CONTENT_FINAL + typoraValueBridge(withUrls)
}
