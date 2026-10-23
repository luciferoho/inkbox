import MarkdownItDefault from 'markdown-it'
import type { MarkdownIt, RendererRule, StateCore } from 'markdown-it'
// core + 常用语言显式注册：lib/common 全量 40+ 语言约占启动包 300KB，
// 未注册语言自动回退纯文本渲染（语言模块自带 alias，sh/ts 等别名仍可用）
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import nginx from 'highlight.js/lib/languages/nginx'
import objectivec from 'highlight.js/lib/languages/objectivec'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import 'katex/dist/katex.min.css'
import { t } from '@/i18n'
import { applyCopiedFeedback, COPY_ICON, writeClipboard } from '@/editor/code-copy'

for (const [name, lang] of Object.entries({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  nginx,
  objectivec,
  perl,
  php,
  plaintext,
  python,
  r,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml
})) {
  hljs.registerLanguage(name, lang)
}
// 供预览/即显两条管线共用同一份 hljs 语言注册表（即显代码高亮见 pm-code-highlight.ts）
export { hljs }
// 扩展语法（1.12）：==高亮== / 上下标 / 脚注；[TOC] 由下方自写规则实现
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import footnote from 'markdown-it-footnote'
// full = GitHub 名单全量词表（bare/light 为精简版）
import { full as emoji } from 'markdown-it-emoji'

/**
 * 统一的 markdown 渲染管线：
 * - html: false —— 原文 HTML 一律转义（安全基线）
 * - 顶层块打 data-source-line 标记 —— 预览/编辑双栏同步滚动用
 * - 任务列表 [ ] / [x] 渲染为复选框
 * - 链接强制新窗口打开
 * - 数学公式 $...$ / $$...$$（katex 懒加载，见 ensureMath）
 * - mermaid 围栏 → 占位 div，由 Preview 异步渲染
 * - 扩展语法：==高亮== ^上标~下标 脚注 [TOC] :emoji: 短代码
 */
export const md: MarkdownIt = MarkdownItDefault({
  html: false,
  linkify: true,
  // 单换行渲染为 <br>（Typora 默认行为）：源码里的换行在预览保持换行观感
  breaks: true,
  highlight(code, lang): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fallthrough */
      }
    }
    return ''
  }
})
  .use(mark)
  .use(sub)
  .use(sup)
  .use(footnote)
  .use(emoji)

/* 表格外套横向滚动容器：窄窗口/超宽表格不压扁内容，改为容器内横向滚动；
   列宽拖拽（2.2）注入的固定 px 宽度也由该容器承接溢出 */
md.renderer.rules.table_open = (tokens, idx, options, _env, self) =>
  `<div class="md-table-wrap">${self.renderToken(tokens, idx, options)}`
md.renderer.rules.table_close = (tokens, idx, options, _env, self) =>
  `${self.renderToken(tokens, idx, options)}</div>`

/* 行内 HTML 白名单（ROADMAP 1.9）：html:false 下原文一律转义，仅白名单内的
   标签放行为真实元素（与即显侧 wysiwyg-extensions 的白名单一致），其余照旧转义。
   不做配对校验：未闭合标签由浏览器就近闭合，行为与 Typora 一致 */
const HTML_WL_RE = /^<(\/?)(u|mark|sub|sup|kbd|b|strong|i|em|s|del|br)(\s[^>]*)?\/?>/i
md.inline.ruler.after('escape', 'luci_html_whitelist', (state, silent) => {
  const m = HTML_WL_RE.exec(state.src.slice(state.pos))
  if (!m) return false
  if (!silent) {
    const tok = state.push('html_inline', '', 0)
    tok.content = m[0]
  }
  state.pos += m[0].length
  return true
})

/* YAML front matter（ROADMAP 1.7）：文档开头的 `---` 块是元信息不是正文，
   默认解析会把它撕成 hr/标题/hr 的碎片——这里按原文行扫描识别出 fm 范围，
   把覆盖到的顶层 token 整体替换为元信息块（带源码行号，参与双栏同步） */
md.core.ruler.push('luci_front_matter', (state: StateCore) => {
  const shifts: number[] = (state.env as { shifts?: number[] } | undefined)?.shifts ?? []
  const toRaw = (processed: number): number => {
    let raw = processed
    for (const s of shifts) if (s <= raw) raw--
    return raw
  }
  const lines = state.src.split('\n')
  if ((lines[0] ?? '').trim() !== '---') return
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    const t = (lines[i] ?? '').trimEnd()
    if (t === '---' || t === '...') {
      end = i
      break
    }
  }
  if (end < 1) return
  const tok = new state.Token('luci_front_matter_block', '', 0)
  tok.content = lines.slice(1, end).join('\n')
  tok.attrSet('data-source-line', '0')
  tok.attrSet('data-source-line-end', String(toRaw(end)))
  // 凡起点落在 fm 行区间内的顶层 token 一律替换（不依赖 token 数组的连续前缀：
  // 集合列表/setext 等结构的 token map 顺序不能想当然）
  state.tokens = [tok, ...state.tokens.filter((t) => !(t.map && t.map[0] <= end))]
})

md.renderer.rules.luci_front_matter_block = (tokens, idx) => {
  const tok = tokens[idx]
  const attrs = ['data-source-line', 'data-source-line-end']
    .map((n) => {
      const v = tok.attrGet(n)
      return v !== null && v !== undefined ? ` ${n}="${escapeHtml(String(v))}"` : ''
    })
    .join('')
  // md-meta-block：Typora 的 front matter 惯用类，主题的 pre.md-meta-block
  // 规则（night 虚线底边/blubook 圆角灰底）借此直接命中我们的元信息块
  return `<section class="md-front-matter"${attrs}><pre class="md-fm-pre md-meta-block">${escapeHtml(tok.content)}</pre></section>\n`
}

/* 顶层块附源码行号（token.map 为 0 基，[start, end)）：供双栏同步滚动插值；
 * 图片 token 另打所在精确行（段内按软/硬换行累计）——供双栏「光标在图片语法上 →
 * 预览对应图高亮」按行定位（同段多图按 DOM 顺序区分）。
 * 渲染源码经过 splitAdjacentOrderedLists 注入过哨兵行，token.map 是「处理后」
 * 行号；编辑器/序列化用的是原始行号——这里统一回映射成原始行号（env.shifts
 * 记录了每个注入点在处理后源码中的行位置），双栏两侧的行号体系才一致 */
md.core.ruler.push('luci_source_line', (state: StateCore) => {
  const shifts: number[] = (state.env as { shifts?: number[] } | undefined)?.shifts ?? []
  const toRaw = (processed: number): number => {
    let raw = processed
    for (const s of shifts) if (s <= raw) raw--
    return raw
  }
  for (const tok of state.tokens) {
    if (tok.map && tok.level === 0 && tok.nesting !== -1) {
      tok.attrSet('data-source-line', String(toRaw(tok.map[0])))
      tok.attrSet('data-source-line-end', String(toRaw(tok.map[1])))
    }
    if (tok.type === 'inline' && tok.map && tok.children) {
      let line = tok.map[0]
      for (const child of tok.children) {
        if (child.type === 'softbreak' || child.type === 'hardbreak') line++
        else if (child.type === 'image') {
          child.attrSet('data-source-line', String(toRaw(line)))
        }
      }
    }
  }
})

/* 标题锚点 id + [TOC] 目录（1-3 级）。
   独占一段的 [TOC]（大小写不限）替换为生成的目录块；标题文本是我们自己
   转义后输出的，不受 html:false 转义策略影响（自定义 token 走专用渲染规则） */
md.core.ruler.push('luci_toc', (state: StateCore) => {
  const toks = state.tokens
  const headings: { level: number; text: string; id: string }[] = []
  let n = 0
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type === 'heading_open') {
      const level = Number(toks[i].tag.slice(1)) || 1
      const id = `luci-h-${++n}`
      toks[i].attrSet('id', id)
      if (level <= 3) headings.push({ level, text: toks[i + 1]?.content ?? '', id })
    }
  }
  for (let i = 1; i < toks.length - 1; i++) {
    if (toks[i].type !== 'inline' || !/^\s*\[TOC\]\s*$/i.test(toks[i].content)) continue
    if (toks[i - 1].type !== 'paragraph_open' || toks[i + 1].type !== 'paragraph_close') continue
    const line = toks[i - 1].attrGet('data-source-line')
    const lineEnd = toks[i - 1].attrGet('data-source-line-end')
    const tok = new state.Token('luci_toc_block', '', 0)
    tok.content = buildTocHtml(headings)
    if (line !== null) tok.attrSet('data-source-line', line)
    if (lineEnd !== null) tok.attrSet('data-source-line-end', lineEnd)
    toks.splice(i - 1, 3, tok)
  }
})

/** 目录块 HTML：按标题层级递归嵌套 <ul>（内部生成，文本已转义） */
function buildTocHtml(headings: { level: number; text: string; id: string }[]): string {
  if (headings.length === 0) return ''
  let i = 0
  const buildLevel = (level: number): string => {
    let html = '<ul>'
    while (i < headings.length && headings[i].level >= level) {
      if (headings[i].level === level) {
        const h = headings[i++]
        html += `<li><a href="#${h.id}">${escapeHtml(h.text)}</a>`
        if (i < headings.length && headings[i].level > level) html += buildLevel(level + 1)
        html += '</li>'
      } else {
        html += buildLevel(level + 1) // 跳级标题归入更深层
      }
    }
    return html + '</ul>'
  }
  return `<nav class="md-toc"><p class="md-toc-title">目录</p>${buildLevel(headings[0].level)}</nav>`
}

md.renderer.rules.luci_toc_block = (tokens, idx) => {
  const tok = tokens[idx]
  // 行号属性一并输出：目录块参与双栏滚动锚定与空行占位统计
  const attrs = ['data-source-line', 'data-source-line-end']
    .map((n) => {
      const v = tok.attrGet(n)
      return v !== null && v !== undefined ? ` ${n}="${escapeHtml(String(v))}"` : ''
    })
    .join('')
  return tok.content.replace('<nav class="md-toc">', `<nav class="md-toc"${attrs}>`)
}

/* 任务列表：把行首 [ ] / [x] / [X] 变成禁用复选框（预览只读） */
md.core.ruler.push('luci_task_lists', (state: StateCore) => {
  const toks = state.tokens
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'inline') continue
    // inline 的前一个 token 必须是 paragraph_open，且再往前是 list_item_open（列表项首段）
    if (i < 2 || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') {
      continue
    }
    const first = toks[i].children?.[0]
    if (!first || first.type !== 'text') continue
    const m = /^\[([ xX])\]\s+/.exec(first.content)
    if (!m) continue
    const checked = m[1] !== ' '
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<input class="task-item-checkbox" type="checkbox" ${
      checked ? 'checked ' : ''
    }disabled tabindex="-1"> `
    toks[i].children!.unshift(box)
    toks[i - 2].attrJoin('class', 'task-list-item')
  }
})

/* 标题内层包一层 span（对齐 Typora DOM）：主题普遍把标题编号写在
   `hN > span:first-of-type::before`、把标题文字样式写在 `#write hN span`
   上（phycat 的 h3-h6 自动编号整组失效）；无类名的裸 span 对内置样式透明 */
md.renderer.rules.heading_open = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options) + '<span>'
md.renderer.rules.heading_close = (tokens, idx, options, _env, self) =>
  '</span>' + self.renderToken(tokens, idx, options)

/* 链接新窗口 + noopener */
const defaultLinkOpen: RendererRule =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

/* 放行 SVG data URI 图片：img 上下文不执行脚本，CSP 另有兜底；
   javascript:/vbscript:/file: 等仍由默认策略拦截 */
const defaultValidateLink = md.validateLink
md.validateLink = (url: string): boolean => {
  if (/^data:image\/svg\+xml/i.test(url)) return true
  return defaultValidateLink(url)
}

/* 相对路径图片 → luci-img:// 协议（本地文件）；文档目录经 render(src, { docDir }) 传入。
 * alt 支持 `![文字|60%|center](src)` 修饰符（尺寸/对齐，与 editor/image-utils 同一套语法）。
 * 注意 alt 属性在默认规则里由 children 文本渲染而来，这里必须显式经
 * renderInlineAsText 取原文、解析修饰符后自行 renderToken（defaultImage 会覆盖回去） */
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const tok = tokens[idx]
  const raw = String(tok.attrGet('src') ?? '')
  const docDir: string | undefined = (env as { docDir?: string } | undefined)?.docDir
  if (raw && docDir && !/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|#)/.test(raw)) {
    // markdown-it 对链接目标做过一次百分号编码（中文/空格 → %XX）：先解码回原始文件名
    // 再重组，否则 encodeURIComponent 二次编码会让主进程解码后剩字面量 % 路径（404 裂图）
    let rel = raw.replace(/^\.\//, '')
    try {
      rel = decodeURIComponent(rel)
    } catch {
      /* 游离 % 序列：按原样拼接 */
    }
    const abs = docDir.replace(/[\\/]+$/, '').replace(/\\/g, '/') + '/' + rel
    tok.attrSet('src', 'luci-img://' + encodeURIComponent(abs).replace(/%2F/gi, '/'))
  }
  // alt 原文（children 渲染成文本，含 | 修饰符）
  let alt = ''
  try {
    alt = self.renderInlineAsText(tok.children ?? [], options, env)
  } catch {
    alt = tok.content ?? ''
  }
  const styles: string[] = []
  let width: string | undefined
  let height: string | undefined
  let altOut = alt
  if (alt.includes('|')) {
    const pipe = alt.indexOf('|')
    altOut = alt.slice(0, pipe)
    for (const t of alt.slice(pipe + 1).split('|')) {
      const tk = t.trim()
      if (/^(left|center|right)$/i.test(tk)) {
        if (tk.toLowerCase() === 'center') styles.push('display:block', 'margin-inline:auto')
        else if (tk.toLowerCase() === 'right') styles.push('display:block', 'margin-left:auto', 'margin-right:0')
        else styles.push('display:block', 'margin-right:auto', 'margin-left:0')
      } else if (/^\d+(\.\d+)?%$/.test(tk)) width = tk
      else {
        const wh = /^(\d+)x(\d+)$/.exec(tk)
        if (wh) {
          width = `${wh[1]}px`
          height = `${wh[2]}px`
        } else if (/^\d+(px)?$/i.test(tk)) width = tk.endsWith('px') ? tk : `${tk}px`
      }
    }
  }
  tok.attrSet('alt', altOut)
  if (width) styles.unshift(`width:${width}`)
  if (height) styles.unshift(`height:${height}`)
  if (styles.length) tok.attrSet('style', styles.join(';'))
  return self.renderToken(tokens, idx, options)
}

/**
 * GitHub 风格居中块（<div align="center"> / <p align="center">，README 最常见的
 * HTML 写法）：白名单式支持——标签必须独占一行，内部内容仍按 markdown 正常渲染，
 * 其余任意 HTML 照旧转义，安全面不变。开/闭标签行原地替换为哨兵，行数一一对应
 * （双栏同步滚动依赖源码行号）。
 */
const CENTER_BLOCK_RE =
  /^[ \t]*<(div|p)\s+align=["']center["']\s*>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\/\1>[ \t]*$/gim

export function preprocessCenter(src: string): string {
  return src.replace(CENTER_BLOCK_RE, (_m, _tag: string, inner: string) => {
    return `@@CENTER_START@@\n${inner}\n@@CENTER_END@@`
  })
}

/**
 * 相邻有序列表分隔（仅渲染层，不改文档内容）：
 * 退出列表后新开的有序列表与上一个列表之间只隔空行时，CommonMark/markdown-it
 * 会把两者并成一个列表继续编号。在接缝注入空 ATX 标题行终止上一个列表——
 * 只分隔、不改写序号：源里是什么号预览就显示什么号（第二个 <ol> 带原字面 start）。
 * 即显（milkdown/remark）管线经 toWysiwygSource 注入同样的哨兵，
 * remark transformer 在解析后移除。
 * shifts（可选）：收集每个哨兵行注入后在输出中的行位置——预览的行号标记
 * 需要凭它把「处理后行号」映射回原始行号（见 luci_source_line 规则）。
 * 顺带：整行 `<br />`（即显空段落的序列化残留）在渲染层视为空行，
 * 避免 html:false 转义后显示成字面文本。
 */
const BR_ONLY_RE = /^[ \t]*<br\s*\/?>[ \t]*$/i

export function splitAdjacentOrderedLists(src: string, shifts?: number[]): string {
  const lines = src.split('\n')
  const out: string[] = []
  let fence: string | null = null
  let prevWasList = false // 最近一个非空行是列表项行（任意标记/缩进）
  let blankRun = 0
  for (const line of lines) {
    const fenceMatch = /^(```+|~~~+).*$/.exec(line)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1].slice(0, 3)
      else if (line.startsWith(fence)) fence = null
      out.push(line)
      prevWasList = false
      blankRun = 0
      continue
    }
    if (fence !== null) {
      out.push(line)
      continue
    }
    if (!line.trim() || BR_ONLY_RE.test(line)) {
      blankRun++
      out.push(BR_ONLY_RE.test(line) ? '' : line)
      continue
    }
    const isTopOrdered = /^\d+[.)][ \t]+\S/.test(line) && line === line.trimStart()
    if (isTopOrdered && blankRun > 0 && prevWasList) {
      // 新组从 1 重新显示：终止符 + 组首项字号重写（组内其余字面号不影响渲染，
      // <ol> 顺序编号；即显里编辑后序列化会把重排落盘）
      out.push('#')
      if (shifts) shifts.push(out.length - 1)
      out.push(line.replace(/^\d+/, '1'))
      prevWasList = true
      blankRun = 0
      continue
    }
    out.push(line)
    prevWasList = /^\s*(?:[-*+]|\d+[.)])[ \t]/.test(line)
    blankRun = 0
  }
  return out.join('\n')
}

/**
 * 有序列表编号归一化（文档打开时一次性整理，Typora 语义）：
 * 空行分隔的有序列表 = 独立列表，各组成员重写为 1..n——源码与预览从打开起就一致，
 * 不必等编辑触发。限制：仅顶层有序组；组前没有其它列表（文档开头/段落后的首个组）
 * 保留字面起始号（「3. 1922 年」类意图）；更深的子列表不动；代码围栏内不动；
 * 分隔符风格（. 或 )）保留原样。
 */
export function normalizeOrderedNumbering(src: string): string {
  const lines = src.split('\n')
  let fence: string | null = null
  let prevTopList = false // 上一个顶层块是有序列表
  let blankRun = 0
  let groupNum = 0 // 当前组的顺序号（0 = 不在组内）
  let groupQualified = false // 当前组前面还有另一个列表（有资格重排）
  for (let i = 0; i < lines.length; i++) {
    const fm = /^(```+|~~~+).*$/.exec(lines[i])
    if (fm) {
      if (fence === null) fence = fm[1].slice(0, 3)
      else if (lines[i].startsWith(fm[1].slice(0, 3))) fence = null
      prevTopList = false
      blankRun = 0
      groupNum = 0
      continue
    }
    if (fence !== null) continue
    if (!lines[i].trim()) {
      blankRun++
      continue
    }
    const isTopOrdered = /^\d+[.)][ \t]+\S/.test(lines[i]) && lines[i] === lines[i].trimStart()
    if (isTopOrdered) {
      // 分隔符风格统一为点号（源里可能混有 milkdown 序列化残留的右括号风格）
      if (/^\d+\)/.test(lines[i])) {
        lines[i] = lines[i].replace(/^(\d+)\)/, (_m, d: string) => `${d}.`)
      }
      if (groupNum === 0 || blankRun > 0) {
        // 组首项：前一个顶层块是有序列表 → 本组有资格从 1 重新编号
        groupQualified = prevTopList
        groupNum = 1
      } else {
        groupNum++
      }
      if (groupQualified) {
        const rewritten = lines[i].replace(/^\d+/, String(groupNum))
        if (rewritten !== lines[i]) lines[i] = rewritten
      }
      prevTopList = true
      blankRun = 0
      continue
    }
    if (lines[i] === lines[i].trimStart()) {
      // 顶层非列表内容行（标题/段落/无序项等）：断组
      prevTopList = false
      groupNum = 0
    }
    blankRun = 0
  }
  return lines.join('\n')
}

/** 渲染结果后处理：哨兵段落替换为真实包裹层（段落带 data-source-line 属性） */
function applyCenter(html: string): string {
  return html
    .replace(/<p[^>]*>@@CENTER_START@@<\/p>/g, '<div class="md-center">')
    .replace(/<p[^>]*>@@CENTER_END@@<\/p>/g, '</div>')
}

/* ---------- 风格归一（内容等价比对专用，不回写文档） ---------- */

/** 表格分隔行单元格（`:---`/`--:` 等） */
const SEP_CELL_RE = /^\s*:?-+:?\s*$/
/** 整行主题分割线：`***`/`---`/`___` 系列（内部可含空格） */
const HR_LINE_RE = /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/

/** 表格行判定：以 | 开头且含未转义 |（即显序列化恒补行首管道；无行首管道的
 *  写法不归一，宁可保守漏配也不误伤普通含 | 的段落） */
function isTableRow(line: string): boolean {
  return /^\|/.test(line) && /(?<!\\)\|/.test(line)
}

/** 行 → 单元格（与 editor/table-utils.splitCells 同规则：去首尾管道、
 *  按未转义 | 切分并 trim；结尾 \| 是转义内容不算收尾管道） */
function splitRowCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map((c) => c.trim())
}

const joinRowCells = (cells: string[]): string => `| ${cells.join(' | ')} |`

/** 分隔行单元格定长化：`:-`/`--:`/按列宽补横线等写法与 `:---`/`---:` 对齐语义一致 */
function canonicalSepCell(cell: string): string {
  const l = cell.startsWith(':')
  const r = cell.endsWith(':')
  return l && r ? ':---:' : l ? ':---' : r ? '---:' : '---'
}

/**
 * 风格归一（masked = 围栏代码块内行，原样保留）：
 * - 表格块：即显序列化会给单元格按列宽补空格、分隔行写最短 `:-` 或按列宽补
 *   横线——同一张表两种写法渲染完全一致，逐字比对不等（"打开即未保存"的主因）。
 *   「表头行 + 整行皆分隔单元格的第 2 行 + 紧随的数据行」整块归一为
 *   `| c1 | c2 |`：单元格去首尾空白，分隔行标记定长。
 * - 主题分割线：`***`/`___`/`- - -` 统一 `---`；仅前行为空行时归一——
 *   紧贴段落的 `---` 是 setext 标题下划线，语义不同，不能碰。
 * - 链接/图片目标的 `./` 前缀（管线把相对路径补成 `./x` 回推）。
 */
function normalizeStyleLines(lines: string[], masked: Set<number>): string[] {
  // 第一遍：链接目标 ./ 前缀（围栏内容不动）
  const out = lines.map((l, i) => (masked.has(i) ? l : l.replace(/\]\(\.\//g, '](')))
  const res: string[] = []
  let i = 0
  while (i < out.length) {
    const l = out[i]
    if (masked.has(i)) {
      res.push(l)
      i++
      continue
    }
    // 表格块（第 2 行整行都是分隔单元格才算，普通含 | 的段落不动）
    const sepCells =
      i + 1 < out.length && !masked.has(i + 1) && isTableRow(l) && isTableRow(out[i + 1])
        ? splitRowCells(out[i + 1])
        : null
    if (sepCells && sepCells.length > 0 && sepCells.every((c) => SEP_CELL_RE.test(c))) {
      let j = i + 2
      while (j < out.length && !masked.has(j) && isTableRow(out[j])) j++
      res.push(joinRowCells(splitRowCells(l)))
      res.push(joinRowCells(sepCells.map(canonicalSepCell)))
      for (let k = i + 2; k < j; k++) res.push(joinRowCells(splitRowCells(out[k])))
      i = j
      continue
    }
    // 主题分割线（前行为空行才归一，避开 setext 下划线）
    if (HR_LINE_RE.test(l) && (i === 0 || !out[i - 1].trim())) {
      res.push('---')
      i++
      continue
    }
    res.push(l)
    i++
  }
  return res
}

/**
 * 内容规范化（草稿新旧比对用，纯文本变换）：与「打开归一化 + 即显序列化归一化」
 * 同规则——编号重排、`1)`→`1.`、`*`/`+` 项→`-` 项、空白行归一、列表项行首缩进
 * 抹平（嵌套层级的空格风格 milkdown 会重排）、段落行首最多 3 空格剥除
 * （CommonMark 不构成缩进）、围栏标记剥缩进、围栏内容剥公共缩进（列表项内
 * 代码块的框架缩进会被即显序列化抹平；逐行层次缩进不受影响）、列表项之前的
 * 引导空行剥除。围栏代码块内的内容原样保留（真实编辑）。
 * 若两版本仅在这些风格差异上不同（用户没有真实编辑，只是即显序列化回写过），
 * 视为等价：崩溃恢复时草稿丢弃、即显回推不算脏，避免"打开即未保存"。
 * 表格列对齐/分隔行写法、分割线写法、链接目标 ./ 前缀的归一见 normalizeStyleLines。
 */
export function canonicalizeContent(src: string): string {
  const lines = normalizeOrderedNumbering(src.replace(/\r\n?/g, '\n')).split('\n')
  const out: string[] = []
  // 围栏内容/标记行在 out 中的下标（真实内容，风格归一不得触碰）
  const masked = new Set<number>()
  let inFence = false
  let fence: string[] = []
  const flushFence = (): void => {
    const indents = fence.filter((l) => l.trim()).map((l) => /^[\t ]*/.exec(l)![0].length)
    const cut = indents.length ? Math.min(...indents) : 0
    for (const l of fence) {
      masked.add(out.length)
      out.push(cut ? l.slice(Math.min(cut, /^[\t ]*/.exec(l)![0].length)) : l)
    }
    fence = []
  }
  for (const l of lines) {
    if (inFence) {
      if (/^[\t ]*(?:```|~~~)/.test(l)) {
        inFence = false
        flushFence()
        masked.add(out.length)
        out.push(l.replace(/^[\t ]+/, ''))
      } else {
        fence.push(l)
      }
      continue
    }
    if (!l.trim()) {
      out.push('')
      continue
    }
    const stripped = l
      .replace(/^([\t ]*\d+[.)])[\t ]*<br\s*\/?>[\t ]*$/i, '$1') // 列表项内空段落：`2. <br />` → `2.`
      .replace(/^([\t ]*)[*+]([\t ])/, '$1-$2')
      .replace(/^([\t ]*\d+)\)/, '$1.')
    if (/^[\t ]*(?:```|~~~)/.test(stripped)) {
      inFence = true
      masked.add(out.length)
      out.push(stripped.replace(/^[\t ]+/, ''))
      continue
    }
    // 列表项：嵌套缩进整体抹平；普通段落：行首最多 3 空格不构成缩进
    out.push(
      /^[\t ]*(?:[-*+]|\d+[.)])[\t ]/.test(stripped)
        ? stripped.replace(/^[\t ]+/, '')
        : stripped.replace(/^[\t ]{1,3}/, '')
    )
  }
  flushFence()
  // 列表项之前的引导空行：即显序列化常省略（无序列表可打断段落）。
  // 尾随空行/换行同样抹平：milkdown 序列化不保证文末换行，与磁盘文本（Typora
  // 惯例保留尾随换行）只差文末空行时不算真实编辑——否则"打开即未保存"
  return normalizeStyleLines(out, masked)
    .join('\n')
    .replace(/\n\n+(?=(?:[-*+]|\d+[.)])[\t ])/g, '\n')
    .replace(/[\s\n]+$/, '')
}

/** 空标题哨兵的渲染产物（splitAdjacentOrderedLists 注入，渲染后剥除） */
const LIST_SPLIT_RE = /<h1(\s[^>]*)?>\s*<\/h1>\n?/g

/** 带文档目录渲染（相对图片解析用） */
export function renderWithDir(src: string, docDir: string | null): string {
  const shifts: number[] = []
  const preprocessed = splitAdjacentOrderedLists(preprocessCenter(src), shifts)
  const env: { docDir?: string; shifts?: number[] } = { shifts }
  if (docDir) env.docDir = docDir
  const html = md.render(preprocessed, env)
  return applyCenter(html).replace(LIST_SPLIT_RE, '')
}

/* ---------- 数学公式：katex 懒加载 ---------- */

type KatexModule = typeof import('katex')
let katexMod: KatexModule | null = null
let katexLoading: Promise<void> | null = null

function katexRender(tex: string, displayMode: boolean): string {
  if (!katexMod) return ''
  try {
    return katexMod.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'html'
    })
  } catch {
    return `<code class="math-error">${escapeHtml(tex)}</code>`
  }
}

function installMathRules(): void {
  // 行内 $...$：内容非空且不以空白起止（挡住 "$100 和 $200" 这类货币写法）
  md.inline.ruler.after('escape', 'luci_math_inline', (state, silent) => {
    const start = state.pos
    if (state.src[start] !== '$' || state.src[start + 1] === '$') return false
    const end = state.src.indexOf('$', start + 1)
    if (end < 0) return false
    const tex = state.src.slice(start + 1, end)
    if (!tex.trim() || /^\s|\s$/.test(tex)) return false
    if (!silent) {
      const token = state.push('html_inline', '', 0)
      token.content = katexRender(tex, false)
      // 原始 TeX 存 meta：导出 LaTeX 需要公式源码（content 已是渲染 HTML）
      token.meta = { tex }
      state.pos = end + 1
    } else {
      state.pos = end + 1
    }
    return true
  })

  // 块级 $$...$$（单行或跨行）
  md.block.ruler.before('paragraph', 'luci_math_block', (state, startLine, endLine, silent) => {
    const lineStart = state.bMarks[startLine] + state.tShift[startLine]
    const firstLine = state.src.slice(lineStart, state.eMarks[startLine])
    if (!firstLine.trimStart().startsWith('$$')) return false

    let tex: string
    let lastLine: number
    const inlineEnd = firstLine.trimStart().indexOf('$$', 2)
    if (inlineEnd >= 2) {
      tex = firstLine.trimStart().slice(2, inlineEnd)
      lastLine = startLine
    } else {
      const lines: string[] = []
      let found = false
      let line = startLine + 1
      for (; line < endLine; line++) {
        const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
        const closeIdx = text.indexOf('$$')
        if (closeIdx >= 0) {
          if (closeIdx > 0) lines.push(text.slice(0, closeIdx))
          found = true
          break
        }
        lines.push(text)
      }
      if (!found) return false
      tex = lines.join('\n')
      lastLine = line
    }
    if (!tex.trim()) return false

    if (!silent) {
      const token = state.push('luci_math_block', 'math', 0)
      token.content = tex
      token.markup = '$$'
      token.map = [startLine, lastLine + 1]
      token.block = true
    }
    state.line = lastLine + 1
    return true
  })

  md.renderer.rules.luci_math_block = (tokens, idx) => {
    const tok = tokens[idx]
    const line = tok.attrGet('data-source-line')
    const lineEnd = tok.attrGet('data-source-line-end')
    const attrs = [
      line !== null ? `data-source-line="${line}"` : '',
      lineEnd !== null ? `data-source-line-end="${lineEnd}"` : ''
    ]
      .filter(Boolean)
      .join(' ')
    return `<div class="math-block" ${attrs}>${katexRender(tok.content, true)}</div>`
  }
}

/** 文档含 $ 时才加载 katex（约 300KB），加载后数学规则生效 */
export function ensureMath(src: string): Promise<void> {
  if (katexMod || !src.includes('$')) return Promise.resolve()
  katexLoading ??= import('katex').then((m) => {
    katexMod = (m.default ?? m) as KatexModule
    installMathRules()
  })
  return katexLoading
}

/* ---------- 代码块 chrome：语言标签栏 + 复制按钮（md-preview 渲染管线） ---------- */

let codeCopyBound = false
function ensureCodeCopyHandler(): void {
  if (codeCopyBound) return
  codeCopyBound = true
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.(
      '.md-code-copy'
    ) as HTMLButtonElement | null
    if (!btn) return
    const text = btn.closest('.md-code')?.querySelector('pre')?.textContent ?? ''
    if (!text) return
    void writeClipboard(text).then((ok) => {
      if (ok) applyCopiedFeedback(btn, t('code.copied'), t('code.copy'))
    })
  })
}

const defaultFence: RendererRule =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const tok = tokens[idx]
  const info = tok.info.trim()
  if (info.split(/\s+/)[0] !== 'mermaid') {
    // 代码块 chrome：语言标签栏 + 复制按钮（导出走 Preview DOM 剥离，见 ExportDialog）
    const lang = escapeHtml(info.split(/\s+/)[0].toLowerCase())
    ensureCodeCopyHandler()
    const inner = defaultFence(tokens, idx, options, env, self)
    const label = escapeHtml(t('code.copy'))
    return (
      `<div class="md-code"><div class="md-code-bar">` +
      `<span class="md-code-lang">${lang}</span>` +
      `<button type="button" class="md-code-copy" title="${label}" aria-label="${label}">${COPY_ICON}</button>` +
      `</div>${inner}</div>`
    )
  }
  const line = tok.attrGet('data-source-line')
  const lineEnd = tok.attrGet('data-source-line-end')
  const attrs = [
    line !== null ? `data-source-line="${line}"` : '',
    lineEnd !== null ? `data-source-line-end="${lineEnd}"` : ''
    // language-mermaid 仅为占位标记，防止 hljs 误高亮
  ]
    .filter(Boolean)
    .join(' ')
  return `<div class="mermaid" ${attrs}>${escapeHtml(tok.content)}</div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface OutlineItem {
  level: number
  text: string
  /** 1 基行号 */
  line: number
}

/** 解析标题树，支持各类合法写法：
 *  - ATX（`## 标题`，允许≤3空格缩进；`## 标题 ##` 闭合式剥尾巴）
 *  - Setext 下划线式（`标题` + `===`/`---`；列表/引用/缩进代码行不参与，
 *    纯 `---` 行（分隔线）本身不作标题文本）
 *  - 引用块 / 列表项内的标题（剥容器前缀后识别）
 *  - YAML frontmatter（文档首 `---` 包裹区）整体跳过
 *  - 围栏代码块（``` / ~~~）与缩进代码块内的 # 一律不识别 */
export function parseOutline(src: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = src.split(/\r?\n/)
  let fence: string | null = null
  /** 上一行可作 Setext 文本时的原文（保留行内标记供大纲渲染样式）；null = 不可 */
  let prevText: string | null = null
  /** 文档首行是 --- 时进入 frontmatter 区，遇到下一个 --- / ... 结束 */
  let inFrontmatter = /^---[ \t]*$/.test(lines[0] ?? '')
  const UNDERLINE_RE = /^[ \t]{0,3}(=+|-+)[ \t]*$/
  const THEMATIC_RE = /^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
  const CONTAINER_RE = /^(?:[ \t]{0,3}(?:>[ \t]?|(?:[-*+]|\d+[.)])[ \t]+))+/
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/\s+$/, '')
    if (inFrontmatter) {
      if (i > 0 && /^(---|\.\.\.)[ \t]*$/.test(line)) inFrontmatter = false
      continue
    }
    const fenceMatch = /^[ \t]{0,3}(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1].slice(0, 3)
      else if (line.trimStart().startsWith(fence)) fence = null
      prevText = null
      continue
    }
    if (fence !== null) continue

    // Setext：上一行是普通文本行，本行是 === / --- 下划线
    if (prevText !== null && UNDERLINE_RE.test(line)) {
      items.push({ level: line.trimStart()[0] === '=' ? 1 : 2, text: prevText, line: i })
      prevText = null
      continue
    }

    // 剥容器前缀（可叠加的引用/列表标记）后识别 ATX（允许≤3空格缩进）
    const stripped = line.replace(CONTAINER_RE, '')
    const m = /^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/.exec(stripped)
    if (m) {
      // 闭合 ATX：行尾 ` #+`（前置空白）视为闭合序列剥除；`C#` 不受影响
      const text = m[2].replace(/[ \t]+#{1,6}[ \t]*$/, '').trim()
      items.push({ level: m[1].length, text, line: i + 1 })
      prevText = null
      continue
    }

    if (!line.trim()) {
      prevText = null
      continue
    }
    // 可作 Setext 文本的条件：非空、非容器行、非缩进代码、非分隔线/下划线本身
    const isContainer = stripped !== line.trim() && CONTAINER_RE.test(line)
    prevText =
      !isContainer && !/^[ \t]{4,}/.test(line) && !THEMATIC_RE.test(line) && !UNDERLINE_RE.test(line)
        ? stripped.trim()
        : null
  }
  return items
}
