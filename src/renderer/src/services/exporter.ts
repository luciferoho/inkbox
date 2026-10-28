import previewCssRaw from '@/assets/preview.css?raw'
import { stripInteractiveCss } from './appearance'
/* 预览 CSS 的交互态（hover/copy 按钮）对静态导出无意义且会带来鼠标反馈，
   注入前剥离（与主题 CSS 同一处理，见 appearance.stripInteractiveCss） */
const previewCss = stripInteractiveCss(previewCssRaw)
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
  --code-bg: #f5f4f1;
  --code-fg: #37352f;
  --code-edge: rgba(55, 53, 47, 0.1);
  --code-comment: #9b968c;
  --code-keyword: #b26a1b;
  --code-string: #55793c;
  --code-number: #b8503f;
  --code-title: #3565a3;
  --code-attr: #8a6d2f;
  --code-type: #7a55c0;
  --code-deletion: #c2503e;
`
const CODE_TOKENS_DARK = `
  --code-bg: #1c1f27;
  --code-fg: #d2d8e2;
  --code-edge: rgba(210, 218, 230, 0.15);
  --code-comment: #7d8595;
  --code-keyword: #ecb96f;
  --code-string: #a5c795;
  --code-number: #e39a92;
  --code-title: #9cc3e8;
  --code-attr: #d0b283;
  --code-type: #c2aeee;
  --code-deletion: #d97764;
`

/* 导出排版兜底：主题 CSS 注入在页面样式之后，可能带来自身场景的 pre/code
   规则（如 overflow: visible / 行为改动）导致长代码行溢出容器（PNG 长图里
   溢出 = 内容被裁掉）。在 extraCss 之后统一收口：代码块折行，绝不横向出界 */
const EXPORT_FALLBACK_LAYOUT = `
/* 导出是静态介质（长图/打印页），不存在横向滚动交互：内容已强制折行，
   overflow visible 既不渲染滚动条，也不建立会破坏 Chromium 打印分页的
   裁切容器（overflow hidden/auto 的块跨页时后续兄弟会被异常推页） */
.md-preview pre { overflow: visible !important; max-width: 100%; }
.md-preview pre code { white-space: pre-wrap !important; word-break: break-word; }
.md-preview .md-code-bar { display: none !important; }
/* 行号是应用内的编辑辅助（::before 计数列），导出产物不携带——且行号列
   会造成 ~15px 横向溢出，让代码块出滚动条（长图被裁/PDF 出横滚） */
.md-preview pre code .md-cl::before { display: none !important; }
/* hover 态在源头已剥（previewCss/主题 CSS 注入前经 stripInteractiveCss），
   静态产物无任何鼠标反馈 */
.md-preview * { cursor: default !important; }
`

/* PDF 打印净化：PDF 固定白底，暗色自定义主题的文字色（浅色文字）在白底上
   不可读——主题 CSS 注入后重申亮色令牌并强制正文/代码/引用的深色，排版
   （间距/字体/结构）保留主题效果 */
const EXPORT_SANITIZE_PRINT = `
body, .md-preview.export-page { background: #fff !important; }
.md-preview {
  color: #1f2328 !important;
  --bg: #fff; --surface: #fff; --surface-2: #f6f8fa; --border: #d0d7de;
  --text: #1f2328; --text-2: #57606a;
  --accent: #b16014; --accent-strong: #954d0d; --accent-soft: rgba(177, 96, 20, 0.1);
  --code-bg: #f6f8fa; --code-fg: #1f2328; --code-bar: #eaeef2;
  --code-comment: #57606a; --code-keyword: #cf222e; --code-string: #0a3069;
  --code-number: #0550ae; --code-title: #0550ae; --code-attr: #953800;
  --code-type: #8250df; --code-deletion: #cf222e;
  --inline-code-bg: #eff1f3;
}
.md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4,
.md-preview h5, .md-preview h6, .md-preview p, .md-preview li,
.md-preview td, .md-preview th, .md-preview strong, .md-preview em,
.md-preview del, .md-preview figcaption { color: #1f2328 !important; }
.md-preview a { color: #0969da !important; }
.md-preview blockquote { color: #57606a !important; border-left-color: #d0d7de !important; }
.md-preview pre, .md-preview pre code { color: #1f2328 !important; }
.md-preview table, .md-preview th, .md-preview td { border-color: #d0d7de !important; }
.md-preview hr { border-color: #d0d7de !important; }
`

/* 纸面亮色主题的设计令牌（HTML/PNG 导出可选亮暗，PDF 固定亮色白底打印） */
const EXPORT_TOKENS_LIGHT = `
:root {
  --bg: #faf9f7;
  --surface: #ffffff;
  --surface-2: #f2f0ec;
  --border: #e6e3dd;
  --text: #37352f;
  --text-2: #86817a;
  --accent: #c9701f;
  --accent-strong: #b16014;
  --accent-soft: rgba(201, 112, 31, 0.1);
  --danger: #c2503e;
  --export-shadow: 0 1px 3px rgba(40, 38, 33, 0.05), 0 16px 44px rgba(40, 38, 33, 0.06);
  --radius-m: 10px;
  --font-ui: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif;
  --font-serif: Georgia, 'Source Serif SC', 'Noto Serif SC', 'Times New Roman', serif;
  --font-mono: 'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  --preview-font-size: 16px;
  --preview-line-height: 1.7;
${CODE_TOKENS_LIGHT}
}
`

/* 墨匣暗色主题的设计令牌（暗色导出：深底浅字，代码块同为暗色） */
const EXPORT_TOKENS_DARK = `
:root {
  --bg: #171a21;
  --surface: #1e212a;
  --surface-2: #272b35;
  --border: #2b2f3a;
  --text: #d2d8e2;
  --text-2: #8d95a5;
  --accent: #e3a45c;
  --accent-strong: #edb877;
  --accent-soft: rgba(227, 164, 92, 0.13);
  --danger: #d97764;
  --export-shadow: 0 1px 3px rgba(0, 0, 0, 0.28), 0 16px 44px rgba(0, 0, 0, 0.42);
  --radius-m: 10px;
  --font-ui: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif;
  --font-serif: Georgia, 'Source Serif SC', 'Noto Serif SC', 'Times New Roman', serif;
  --font-mono: 'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  --preview-font-size: 16px;
  --preview-line-height: 1.7;
${CODE_TOKENS_DARK}
}
`

const EXPORT_TOKENS_COMMON = `
* { box-sizing: border-box; margin: 0; padding: 0; }
/* 文档字族回落（M3）：外部主题/用户 CSS 覆盖 --font-body/--font-code 即生效 */
:root {
  --font-body: var(--font-ui);
  --font-code: var(--font-mono);
  --inline-code-bg: var(--surface-2);
  --inline-code-fg: inherit;
  --inline-code-border: transparent;
}
`

/* 任务列表几何加固：主题的 `.md-task-list-item > input { margin-left: -1.3em }`
   （Typora 结构假设）与 preview.css 的 li 负 margin 叠加，再叠上表单控件
   固定的 em 基准（input 恒 13.33px ≠ 正文 13px），会把复选框拉出内容盒——
   打印无外层 padding 时贴页缘被裁、续行与首行错位压到复选框（导出 PDF 实测）。
   复选框改绝对定位钉在行首、文本块统一缩进，与主题/字号解耦。
   必须注入在主题（extraCss）之后才能压住主题的负 margin */
const EXPORT_TASK_LIST_FIX = `
.md-preview.md-preview li.task-list-item,
.md-preview.md-preview li[data-item-type='task'] {
  position: relative;
  margin-left: 0 !important;
  padding-left: 1.7em !important;
  text-indent: 0 !important;
}
.md-preview.md-preview li.task-list-item > input.task-item-checkbox,
.md-preview.md-preview li[data-item-type='task'] > input.task-item-checkbox {
  position: absolute;
  left: 0;
  top: 0.32em;
  margin: 0 !important;
}
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

/** 去掉列宽拖拽固化的内联宽度/布局样式：列宽是视图态，导出产物必须自适应。
 *  在 HTML 字符串层再兜一次（调用方可能直接传预览 innerHTML，未经 ExportDialog 清洗） */
function stripTableWidthStyles(html: string): string {
  if (!/table|width\s*:/i.test(html)) return html
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return html
  root.querySelectorAll('table, th, td').forEach((el) => {
    const s = el as HTMLElement
    s.style.removeProperty('width')
    s.style.removeProperty('min-width')
    s.style.removeProperty('max-width')
    s.style.removeProperty('table-layout')
    if (!s.getAttribute('style')) s.removeAttribute('style')
  })
  return root.innerHTML
}

export interface BuildExportOptions {
  /** true = 打印/PDF 用：白底、打印密度、分页保护 */
  forPrint?: boolean
  /** 导出主题：代码块等配色跟随应用当前明暗（缺省 light） */
  theme?: 'light' | 'dark'
  /** 附加 CSS（M3 3.4）：外部主题 + 用户自定义样式，注入在所有内置样式之后 */
  extraCss?: string
}

export async function buildExportHtml(
  title: string,
  previewHtml: string,
  opts: BuildExportOptions = {}
): Promise<string> {
  const [katexInlined, body] = await Promise.all([
    inlineKatexFonts(katexCss),
    inlineImages(stripTableWidthStyles(previewHtml))
  ])

  /* 打印密度：A4 上 16px 正文太稀，落到 13px / 1.65 行距。
     PDF 固定亮色白底（打印观感），theme 选项仅对 HTML/PNG 生效 */
  const theme = opts.forPrint ? 'light' : opts.theme ?? 'light'
  const tokens = theme === 'dark' ? EXPORT_TOKENS_DARK : EXPORT_TOKENS_LIGHT
  const pageCss = opts.forPrint
    ? `
html, body { overflow-x: hidden; }
body { background: #fff; padding: 0; }
.export-page { max-width: none; margin: 0; border: none; border-radius: 0; box-shadow: none; }
.md-preview { --preview-font-size: 13px; --preview-line-height: 1.65; padding: 0 0 6px; }
.md-preview pre code { font-size: 11px; }
.md-preview h1 { font-size: 1.55em; }
.md-preview h2 { font-size: 1.3em; }
/* 分页保护：标题不与后文断开；长代码块/大表格允许自然跨页（整块 avoid 会
   推到新页留大片空白），表格按行断、行内不截。注意：P4 型"近空白页"的
   真因是文档内的显式分页标记（md-pagebreak，Typora 兼容），不是这些规则 */
.md-preview h1, .md-preview h2, .md-preview h3,
.md-preview h4, .md-preview h5, .md-preview h6 { break-after: avoid; }
.md-preview .mermaid,
.md-preview blockquote, .md-preview .math-block, .md-preview img { break-inside: avoid; }
.md-preview table, .md-preview .md-table-wrap { break-inside: auto; }
.md-preview tr { break-inside: avoid; }
/* 孤行控制 3 行：段落断页首尾各保 3 行，避免残行单独占据新页顶部 */
.md-preview p, .md-preview li { orphans: 3; widows: 3; }
/* 超宽表格：打印页宽固定，强制自适应换行（导出不应出现横向裁切） */
.md-preview .md-table-wrap { overflow: visible; max-width: 100%; }
.md-preview table { width: 100% !important; table-layout: auto !important; font-size: 10.5px; }
/* 块级 HTML 表格（图片版式）：固定布局让列宽均分，图片收敛到列内——
   auto 布局会按 2560px 大图的固有宽度分列，导出页宽装不下 */
.md-preview table.luci-html-table { table-layout: fixed !important; }
.md-preview table.luci-html-table img { max-width: 100% !important; height: auto; }
.md-preview th, .md-preview td {
  width: auto !important; white-space: normal !important;
  word-break: break-word; overflow-wrap: anywhere; padding: 4px 6px;
}
/* 打印产物不出现滚动条：代码块自动换行；宽图收敛到页宽 */
.md-preview pre { overflow: hidden !important; white-space: pre-wrap; word-break: break-word; break-inside: auto; }
.md-preview pre code { white-space: pre-wrap; }
.md-preview img, .md-preview svg { max-width: 100% !important; height: auto; }
`
    : `
body { background: var(--bg); padding: 40px 20px 64px; }
.export-page {
  max-width: 820px;
  margin: 0 auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--export-shadow);
}
.md-preview { padding: 24px 44px 36px; }
.md-preview img { cursor: default; }
.md-preview tr:nth-child(even) td {
  background: color-mix(in srgb, var(--surface-2) 55%, transparent);
}
/* 超宽表格：导出页宽固定，去掉预览的横向滚动与拖拽宽度，自适应换行 */
.md-preview .md-table-wrap { overflow: visible; max-width: 100%; }
.md-preview table { width: 100% !important; table-layout: auto !important; }
/* 块级 HTML 表格：固定布局均分列宽 + 图片收敛到列内（同打印分支） */
.md-preview table.luci-html-table { table-layout: fixed !important; }
.md-preview table.luci-html-table img { max-width: 100% !important; height: auto; }
.md-preview th, .md-preview td {
  width: auto !important; white-space: normal !important;
  word-break: break-word; overflow-wrap: anywhere;
}
/* 暗色导出滚动条：跟随主题令牌，避免浏览器默认亮色滚动条刺眼 */
.md-preview pre, .md-preview .md-table-wrap {
  scrollbar-width: thin;
  scrollbar-color: ${theme === 'dark' ? '#5c564e' : '#c9c2b8'} transparent;
}
.md-preview pre::-webkit-scrollbar,
.md-preview .md-table-wrap::-webkit-scrollbar { width: 8px; height: 8px; }
.md-preview pre::-webkit-scrollbar-track,
.md-preview .md-table-wrap::-webkit-scrollbar-track { background: transparent; }
.md-preview pre::-webkit-scrollbar-thumb,
.md-preview .md-table-wrap::-webkit-scrollbar-thumb {
  background: ${theme === 'dark' ? '#5c564e' : '#c9c2b8'};
  border-radius: 4px;
}
.md-preview pre::-webkit-scrollbar-corner,
.md-preview .md-table-wrap::-webkit-scrollbar-corner { background: transparent; }
`

  /* 关键：容器必须带 .md-preview，preview.css 的全部排版规则以它为前缀。
     data-theme 与令牌集同主题注入：整页（纸面/文字/代码块/语法色）随所选明暗 */
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${tokens}</style>
<style>${EXPORT_TOKENS_COMMON}</style>
<style>${katexInlined}</style>
<style>${previewCss}</style>
<style>${pageCss}</style>
${opts.extraCss ? `<style>${opts.extraCss}</style>` : ''}
<style>${EXPORT_FALLBACK_LAYOUT}</style>
${opts.forPrint ? `<style>${EXPORT_SANITIZE_PRINT}</style>` : ''}
<style>${EXPORT_TASK_LIST_FIX}</style>
</head>
<body>
<article class="md-preview export-page">
${body}
</article>
</body>
</html>`
}
