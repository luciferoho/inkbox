import previewCss from '@/assets/preview.css?raw'
import katexCss from 'katex/dist/katex.min.css?raw'
/* 字体用显式 ?url 导入（import.meta.glob 扫不到 node_modules；dev 下 ?url 的
   css fetch 到的是转换后模块而非文本，故 CSS 用 raw、字体单独引入再内联） */
import katexAms from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?url'
import katexCalBold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?url'
import katexCalReg from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?url'
import katexFrakBold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?url'
import katexFrakReg from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?url'
import katexMainBold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?url'
import katexMainBoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?url'
import katexMainItalic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?url'
import katexMainReg from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?url'
import katexMathBoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?url'
import katexMathItalic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?url'
import katexSansBold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?url'
import katexSansItalic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?url'
import katexSansReg from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?url'
import katexScript from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?url'
import katexSize1 from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?url'
import katexSize2 from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?url'
import katexSize3 from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?url'
import katexSize4 from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?url'
import katexType from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?url'

/**
 * 导出管线：把预览面板已渲染好的 HTML（含 KaTeX 公式、mermaid SVG、
 * highlight.js 配色）打包成单文件 HTML。
 * - CSS 内联：preview.css + katex.min.css（固定纸面亮色主题，打印/分享观感一致）
 * - KaTeX 字体内联为 data URI（woff2，浏览器按 src 顺序取第一个可用格式）
 * - luci-img:// 本地图片转 base64 data URI；网络图片保持外链
 */

/* katex.min.css 里的 url(fonts/X.woff2) 相对引用 → 打包后的资源 URL */
const FONT_ASSETS: Record<string, string> = {
  'KaTeX_AMS-Regular.woff2': katexAms,
  'KaTeX_Caligraphic-Bold.woff2': katexCalBold,
  'KaTeX_Caligraphic-Regular.woff2': katexCalReg,
  'KaTeX_Fraktur-Bold.woff2': katexFrakBold,
  'KaTeX_Fraktur-Regular.woff2': katexFrakReg,
  'KaTeX_Main-Bold.woff2': katexMainBold,
  'KaTeX_Main-BoldItalic.woff2': katexMainBoldItalic,
  'KaTeX_Main-Italic.woff2': katexMainItalic,
  'KaTeX_Main-Regular.woff2': katexMainReg,
  'KaTeX_Math-BoldItalic.woff2': katexMathBoldItalic,
  'KaTeX_Math-Italic.woff2': katexMathItalic,
  'KaTeX_SansSerif-Bold.woff2': katexSansBold,
  'KaTeX_SansSerif-Italic.woff2': katexSansItalic,
  'KaTeX_SansSerif-Regular.woff2': katexSansReg,
  'KaTeX_Script-Regular.woff2': katexScript,
  'KaTeX_Size1-Regular.woff2': katexSize1,
  'KaTeX_Size2-Regular.woff2': katexSize2,
  'KaTeX_Size3-Regular.woff2': katexSize3,
  'KaTeX_Size4-Regular.woff2': katexSize4,
  'KaTeX_Typewriter-Regular.woff2': katexType
}

const IMG_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

/* 代码块语法令牌（与 base.css 双主题同名，导出产物脱离应用也要有值） */
const CODE_TOKENS_LIGHT = `
  --code-bg: #f2ecdf;
  --code-fg: #2b2420;
  --code-edge: rgba(38, 32, 25, 0.08);
  --code-comment: #9c9184;
  --code-keyword: #b16014;
  --code-string: #57783b;
  --code-number: #b8503f;
  --code-title: #3565a3;
  --code-attr: #8a6d2f;
  --code-type: #7a55c0;
  --code-deletion: #c2503e;
`
const CODE_TOKENS_DARK = `
  --code-bg: #26201a;
  --code-fg: #ece4d8;
  --code-edge: rgba(255, 244, 230, 0.07);
  --code-comment: #8a7f70;
  --code-keyword: #f4c67f;
  --code-string: #a8c98a;
  --code-number: #e8a3a0;
  --code-title: #9fc6e8;
  --code-attr: #d4b483;
  --code-type: #c9b3f0;
  --code-deletion: #d66a55;
`

/* 纸面亮色主题的设计令牌（导出固定亮色：分享与打印观感一致） */
const EXPORT_TOKENS = `
:root {
  --surface: #ffffff;
  --surface-2: #efe9e0;
  --border: #e4dcd0;
  --text: #2b2420;
  --text-2: #7c7267;
  --accent: #c9701f;
  --accent-strong: #b16014;
  --accent-soft: rgba(201, 112, 31, 0.12);
  --danger: #c2503e;
  --radius-m: 10px;
  --font-ui: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif;
  --font-serif: Georgia, 'Source Serif SC', 'Noto Serif SC', 'Times New Roman', serif;
  --font-mono: 'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  --preview-font-size: 16px;
  --preview-line-height: 1.7;
${CODE_TOKENS_LIGHT}
}
[data-theme='dark'] {
${CODE_TOKENS_DARK}
}
* { box-sizing: border-box; margin: 0; padding: 0; }
`

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/* KaTeX 字体 data URI（会话级缓存，导出多个文档不重复转换） */
const fontDataUri = new Map<string, string>()

/** 把 katex.min.css 里的 url(fonts/X.woff2) 全部替换为 data URI（单文件离线可用） */
async function inlineKatexFonts(css: string): Promise<string> {
  const re = /url\((['"]?)fonts\/([A-Za-z0-9_-]+\.woff2)\1\)/g
  const names = [...new Set([...css.matchAll(re)].map((m) => m[2]))]
  let out = css
  for (const name of names) {
    let uri = fontDataUri.get(name)
    if (uri === undefined) {
      const assetUrl = FONT_ASSETS[name]
      if (assetUrl) {
        try {
          const resp = await fetch(assetUrl)
          uri = `data:font/woff2;base64,${bufToBase64(await resp.arrayBuffer())}`
        } catch {
          uri = '' // 字体获取失败：公式退回系统字体，不阻塞导出
        }
      } else {
        uri = ''
      }
      fontDataUri.set(name, uri)
    }
    if (uri) out = out.split(`fonts/${name}`).join(uri)
  }
  return out
}

/** luci-img:// 本地图片 → base64 data URI（读取失败的图片保留原样） */
async function inlineImages(html: string): Promise<string> {
  const re = /src="luci-img:\/\/([^"]+)"/g
  const srcs = [...new Set([...html.matchAll(re)].map((m) => m[1]))]
  let out = html
  for (const raw of srcs) {
    const abs = decodeURIComponent(raw)
    const ext = (abs.split('.').pop() ?? '').toLowerCase()
    const mime = IMG_MIME[ext]
    if (!mime) continue
    try {
      const base64 = await window.api.fs.readBinary(abs)
      out = out
        .split(`src="luci-img://${raw}"`)
        .join(`src="data:${mime};base64,${base64}"`)
    } catch {
      /* 图片读不到（被移动/删除）→ 保留 luci-img 引用 */
    }
  }
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface BuildExportOptions {
  /** true = 打印/PDF 用：白底、打印密度、分页保护 */
  forPrint?: boolean
  /** 导出主题：代码块等配色跟随应用当前明暗（缺省 light） */
  theme?: 'light' | 'dark'
}

export async function buildExportHtml(
  title: string,
  previewHtml: string,
  opts: BuildExportOptions = {}
): Promise<string> {
  const [katexInlined, body] = await Promise.all([
    inlineKatexFonts(katexCss),
    inlineImages(previewHtml)
  ])

  /* 打印密度：A4 上 16px 正文太稀，落到 13px / 1.65 行距 */
  const pageCss = opts.forPrint
    ? `
body { background: #fff; padding: 0; }
.export-page { max-width: none; margin: 0; border: none; border-radius: 0; box-shadow: none; }
.md-preview { --preview-font-size: 13px; --preview-line-height: 1.65; padding: 0 0 6px; }
.md-preview pre code { font-size: 11px; }
.md-preview h1 { font-size: 1.55em; }
.md-preview h2 { font-size: 1.3em; }
/* 分页保护：标题不与后文断开，整块元素不拦腰截断 */
.md-preview h1, .md-preview h2, .md-preview h3,
.md-preview h4, .md-preview h5, .md-preview h6 { break-after: avoid; }
.md-preview pre, .md-preview .mermaid, .md-preview table,
.md-preview blockquote, .md-preview .math-block, .md-preview img { break-inside: avoid; }
.md-preview p, .md-preview li { orphans: 2; widows: 2; }
`
    : `
body { background: #f6f2ec; padding: 40px 20px 64px; }
.export-page {
  max-width: 820px;
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(38, 32, 25, 0.05), 0 16px 44px rgba(38, 32, 25, 0.07);
}
.md-preview { padding: 24px 44px 36px; }
.md-preview img { cursor: default; }
.md-preview tr:nth-child(even) td {
  background: color-mix(in srgb, var(--surface-2) 55%, transparent);
}
`

  /* 关键：容器必须带 .md-preview，preview.css 的全部排版规则以它为前缀。
     data-theme 注入导出主题：代码块/语法色随应用当前明暗 */
  return `<!doctype html>
<html lang="zh-CN" data-theme="${opts.theme ?? 'light'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_TOKENS}</style>
<style>${katexInlined}</style>
<style>${previewCss}</style>
<style>${pageCss}</style>
</head>
<body>
<article class="md-preview export-page">
${body}
</article>
</body>
</html>`
}
