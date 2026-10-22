/**
 * 自定义字体归一与 @font-face 生成 + 内置系统字体选项（设置里下拉选字体）。
 *
 * 字体文件放在 themes 目录（theme-resource://t/ 提供，见 main/ipc/themes.ts）。
 * 族名由文件名去掉字重/风格后缀归一：GlowSansSC-Normal-Bold.otf → 族
 * GlowSansSC + 700，同族多字重共用一个下拉项、各自声明 @font-face 字重，
 * 粗体标题等自动用对字重文件。归一不出来的文件用完整主名当族名（400）。
 */

/** 扫描到的一个字体面（同族多字重各占一条） */
export interface ScannedFontFace {
  family: string
  weight: number
  style: 'normal' | 'italic'
  url: string
  format: string
}

/** 下拉选项：value 是写进配置的 CSS font-family 值（'' = 系统默认） */
export interface FontOption {
  label: string
  value: string
}

const FONT_FORMAT: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
  eot: 'embedded-opentype'
}

/** 字重词（可带 extra/ultra/semi/demi 前缀组合）→ font-weight */
const WEIGHT_WORD: Record<string, number> = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  book: 400, regular: 400, normal: 400, roman: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  heavy: 900, black: 900
}

const TAIL_RE = /[-_ ]?(?:(extra|ultra|semi|demi)[-_ ]?)?(thin|hairline|light|book|regular|normal|roman|medium|bold|heavy|black|italic|oblique)$/i
const NUM_RE = /[-_ ]?([1-9]00)$/i

/** 文件主名 → 族名/字重/风格（从尾部逐段剥字重与风格词，最多 4 段） */
function deriveFamily(stem: string): { family: string; weight: number; style: 'normal' | 'italic' } {
  let name = stem
  let weight = 400
  let style: 'normal' | 'italic' = 'normal'
  for (let i = 0; i < 4; i++) {
    const num = NUM_RE.exec(name)
    if (num) {
      weight = Math.min(900, Math.max(100, Number(num[1])))
      name = name.slice(0, name.length - num[0].length)
      continue
    }
    const m = TAIL_RE.exec(name)
    if (!m) break
    const prefix = (m[1] ?? '').toLowerCase()
    const word = m[2].toLowerCase()
    if (word === 'italic' || word === 'oblique') {
      style = 'italic'
    } else {
      const key = prefix ? prefix + word : word
      const w = WEIGHT_WORD[key] ?? WEIGHT_WORD[word]
      if (w == null) break
      weight = w
    }
    name = name.slice(0, name.length - m[0].length)
    name = name.replace(/[-_ ]+$/, '')
  }
  name = name.replace(/[-_ ]+$/, '')
  return { family: name || stem, weight, style }
}

/** 相对路径列表 → 字体面（去重：同族同字重同风格取第一个） */
export function scanFontFaces(rels: string[]): ScannedFontFace[] {
  const out: ScannedFontFace[] = []
  const seen = new Set<string>()
  for (const rel of rels) {
    const file = rel.split('/').pop() ?? rel
    const dot = file.lastIndexOf('.')
    const ext = dot >= 0 ? file.slice(dot + 1).toLowerCase() : ''
    const format = FONT_FORMAT[ext]
    if (!format) continue
    const stem = dot >= 0 ? file.slice(0, dot) : file
    const { family, weight, style } = deriveFamily(stem)
    const key = family + ' ' + weight + ' ' + style
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ family, weight, style, url: `theme-resource://t/${rel}`, format })
  }
  return out
}

const quote = (s: string): string => `'${s.replace(/'/g, "\\'")}'`

/** 字体面 → @font-face 块（懒加载：声明不等于加载，用到才拉字体文件） */
export function fontFaceCss(faces: ScannedFontFace[]): string {
  return faces
    .map(
      (f) =>
        `@font-face {\n  font-family: ${quote(f.family)};\n  src: url('${f.url}') format('${f.format}');\n` +
        `  font-weight: ${f.weight};\n  font-style: ${f.style};\n}`
    )
    .join('\n')
}

/** 下拉里的自定义字体选项（按族聚合，一族一项） */
export function customFontOptions(faces: ScannedFontFace[], generic: string): FontOption[] {
  const families = [...new Set(faces.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
  return families.map((fam) => ({ label: fam, value: quote(fam) + ', ' + generic }))
}

/** 族名是否是自动生成的无意义名（Google Fonts 子集文件的 base64 风格文件名）：
 *  过长（≥30）或长且无词根（无连续 3 个小写字母）的收纳到「其他」组，
 *  别混进正常字体。误判只影响分组，不影响可用性 */
export function isGeneratedName(family: string): boolean {
  return family.length >= 30 || (family.length >= 20 && !/[a-z]{3}/.test(family))
}

export function familyValue(family: string, generic: string): string {
  return quote(family) + ', ' + generic
}

/** 内置系统字体（正文字体）：装了就用、没装回落系统默认栈 */
export const BODY_FONT_OPTIONS: FontOption[] = [
  { label: 'Segoe UI', value: "'Segoe UI', system-ui, sans-serif" },
  { label: '微软雅黑 / Microsoft YaHei', value: "'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif" },
  { label: '苹方 / PingFang SC', value: "'PingFang SC', sans-serif" },
  { label: '宋体 / SimSun', value: "'SimSun', 'Songti SC', serif" },
  { label: '黑体 / SimHei', value: "'SimHei', 'Heiti SC', sans-serif" },
  { label: '楷体 / KaiTi', value: "'KaiTi', 'Kaiti SC', serif" },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: '衬线通用 / serif', value: 'serif' },
  { label: '无衬线通用 / sans-serif', value: 'sans-serif' }
]

/** 内置系统字体（代码字体）：等宽系 */
export const CODE_FONT_OPTIONS: FontOption[] = [
  { label: 'Cascadia Code', value: "'Cascadia Code', Consolas, monospace" },
  { label: 'Consolas', value: "Consolas, 'Courier New', monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', Consolas, monospace" },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
  { label: '等宽通用 / monospace', value: 'monospace' }
]
