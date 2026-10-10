/**
 * 图片行修饰符（尺寸/对齐）的解析与应用。
 * 语法挂在 alt 文本里：`![替代文字|60%|center](./xx.assets/a.jpg)`
 * —— `|` 后依次是修饰符：`50%`/`300`/`300x200`（尺寸）与 `left/center/right`（对齐）。
 * 全部是纯文本变换，工具栏按钮单事务应用，Ctrl+Z 可撤销。
 */

export interface ImageMods {
  /** 宽度：'60%' 或 '300px'；undefined = 原始尺寸 */
  width?: string
  /** 高度 px（仅 WxH 写法）；undefined = 按宽高比自适应 */
  height?: string
  align?: 'left' | 'center' | 'right'
}

export interface ImageLine {
  /** 行内第一个图片的完整 markdown（含感叹号到右括号） */
  raw: string
  /** 干净的替代文字（不含修饰符） */
  alt: string
  src: string
  mods: ImageMods
}

const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/

/** 解析修饰符串 → 结构化（未知 token 忽略，保持容错） */
function parseMods(tokens: string[], altText: string): { mods: ImageMods; clean: string } {
  const mods: ImageMods = {}
  const rest: string[] = []
  for (const t of tokens) {
    const tk = t.trim()
    if (/^(left|center|right)$/i.test(tk)) mods.align = tk.toLowerCase() as ImageMods['align']
    else if (/^\d+(\.\d+)?%$/.test(tk)) mods.width = tk
    else {
      const wh = /^(\d+)x(\d+)$/.exec(tk)
      if (wh) {
        mods.width = `${wh[1]}px`
        mods.height = `${wh[2]}px`
      } else if (/^\d+px$/i.test(tk)) mods.width = tk
      else if (tk !== '') rest.push(tk) // 保留未知 token（用户自定义内容不丢）
    }
  }
  return { mods, clean: rest.length ? [altText, ...rest].join('|') : altText }
}

/** 解析一行文本中的图片与修饰符；无图片返回 null */
export function parseImageLine(lineText: string): ImageLine | null {
  const m = IMG_RE.exec(lineText)
  if (!m) return null
  const altRaw = m[1]
  const pipe = altRaw.indexOf('|')
  const altText = pipe >= 0 ? altRaw.slice(0, pipe) : altRaw
  const tokens = pipe >= 0 ? altRaw.slice(pipe + 1).split('|') : []
  const { mods, clean } = parseMods(tokens, altText)
  return { raw: m[0], alt: clean, src: m[2], mods }
}

/** 从 alt 原文解析修饰符（即显 toDOM/工具条用,不依赖整行上下文） */
export function parseAltMods(altRaw: string): { mods: ImageMods; clean: string } {
  const pipe = altRaw.indexOf('|')
  if (pipe < 0) return { mods: {}, clean: altRaw }
  const tokens = altRaw.slice(pipe + 1).split('|')
  return parseMods(tokens, altRaw.slice(0, pipe))
}

/** 由干净 alt + 修饰符重建 alt 原文（即显 setNodeMarkup 用） */
export function buildAltMods(clean: string, mods: ImageMods): string {
  return buildAlt(clean, mods)
}

/** 修饰符 → img style 字符串（与 services/markdown.ts 渲染规则保持一致） */
export function modsToStyle(mods: ImageMods): string {
  const s: string[] = []
  if (mods.width) s.push(`width:${mods.width}`)
  if (mods.height) s.push(`height:${mods.height}`)
  if (mods.align === 'center') s.push('display:block', 'margin-inline:auto')
  else if (mods.align === 'right') s.push('display:block', 'margin-left:auto', 'margin-right:0')
  else if (mods.align === 'left') s.push('display:block', 'margin-right:auto', 'margin-left:0')
  return s.join(';')
}

/** 把修饰符写回 alt 文本（保持「文字|token|token」形态） */
function buildAlt(alt: string, mods: ImageMods): string {
  const tokens: string[] = []
  if (mods.width && mods.height) {
    const w = mods.width.replace(/px$/i, '')
    tokens.push(`${w}x${mods.height.replace(/px$/i, '')}`)
  } else if (mods.width) {
    tokens.push(mods.width)
  }
  if (mods.align) tokens.push(mods.align)
  return tokens.length ? `${alt}|${tokens.join('|')}` : alt
}

/** 应用新修饰符 → 替换后的整行文本（找不到图片时原样返回） */
export function applyImageMods(lineText: string, next: ImageMods): string {
  const info = parseImageLine(lineText)
  if (!info) return lineText
  const rebuilt = `![${buildAlt(info.alt, next)}](${info.src})`
  return lineText.replace(info.raw, rebuilt)
}

/** 步进宽度：百分比 ±10（10–200），像素 ±40（40–4000）；无宽度视作 100% */
export function stepWidth(mods: ImageMods, dir: 1 | -1): ImageMods {
  if (mods.width?.endsWith('%')) {
    const v = Math.min(200, Math.max(10, Math.round(parseFloat(mods.width)) + dir * 10))
    return { ...mods, width: `${v}%` }
  }
  if (mods.width?.endsWith('px')) {
    const v = Math.min(4000, Math.max(40, Math.round(parseFloat(mods.width)) + dir * 40))
    return { ...mods, width: `${v}px` }
  }
  // 原始尺寸 → 步进后进入百分比语义（100% 与原始尺寸观感一致）
  return { ...mods, width: `${100 + dir * 10}%` }
}

/** 当前宽度的人类可读形式（工具栏标签用） */
export function widthLabel(mods: ImageMods): string {
  if (mods.width?.endsWith('%')) return mods.width
  if (mods.width?.endsWith('px')) return mods.width
  return 'auto'
}

/**
 * 图片 src 的展示形态（悬浮提示/工具条地址行）：
 * - luci-img:// 解回用户写的路径（文档目录内 → ./相对路径,目录外 → 绝对路径）
 * - data: 为上传占位图 → 空串（调用方据此不显示）
 * - 其余（http 等）原样
 */
export function luciToDisplaySrc(raw: string, docDir: string | null): string {
  if (!raw || raw.startsWith('data:')) return ''
  if (raw.startsWith('luci-img://')) {
    let abs = raw.slice('luci-img://'.length)
    try {
      abs = decodeURIComponent(abs)
    } catch {
      /* 游离 % 序列按原样 */
    }
    const normAbs = abs.replace(/\\/g, '/')
    if (docDir) {
      const normDir = docDir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
      if (normAbs.toLowerCase().startsWith(normDir + '/')) {
        return './' + normAbs.slice(normDir.length + 1)
      }
    }
    return normAbs
  }
  return raw
}
