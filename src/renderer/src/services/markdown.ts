import MarkdownItDefault from 'markdown-it'
import type { MarkdownIt, RendererRule, StateCore } from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import 'katex/dist/katex.min.css'
// 扩展语法（1.12）：==高亮== / 上下标 / 脚注；[TOC] 由下方自写规则实现
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import footnote from 'markdown-it-footnote'

/**
 * 统一的 markdown 渲染管线：
 * - html: false —— 原文 HTML 一律转义（安全基线）
 * - 顶层块打 data-source-line 标记 —— 预览/编辑双栏同步滚动用
 * - 任务列表 [ ] / [x] 渲染为复选框
 * - 链接强制新窗口打开
 * - 数学公式 $...$ / $$...$$（katex 懒加载，见 ensureMath）
 * - mermaid 围栏 → 占位 div，由 Preview 异步渲染
 * - 扩展语法：==高亮== ^上标~下标 脚注 [TOC]
 */
export const md: MarkdownIt = MarkdownItDefault({
  html: false,
  linkify: true,
  breaks: false,
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
}).use(mark).use(sub).use(sup).use(footnote)

/* 顶层块附源码行号（token.map 为 0 基，[start, end)）：供双栏同步滚动插值 */
md.core.ruler.push('luci_source_line', (state: StateCore) => {
  for (const tok of state.tokens) {
    if (tok.map && tok.level === 0 && tok.nesting !== -1) {
      tok.attrSet('data-source-line', String(tok.map[0]))
      tok.attrSet('data-source-line-end', String(tok.map[1]))
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

md.renderer.rules.luci_toc_block = (tokens, idx) => tokens[idx].content

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

/* 相对路径图片 → luci-img:// 协议（本地文件）；文档目录经 render(src, { docDir }) 传入 */
const defaultImage: RendererRule =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const tok = tokens[idx]
  const raw = String(tok.attrGet('src') ?? '')
  const docDir: string | undefined = (env as { docDir?: string } | undefined)?.docDir
  if (raw && docDir && !/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|#)/.test(raw)) {
    const abs = docDir.replace(/[\\/]+$/, '') + '/' + raw.replace(/^\.\//, '')
    tok.attrSet('src', 'luci-img://' + encodeURIComponent(abs).replace(/%2F/gi, '/'))
  }
  return defaultImage(tokens, idx, options, env, self)
}

/** 带文档目录渲染（相对图片解析用） */
export function renderWithDir(src: string, docDir: string | null): string {
  return md.render(src, docDir ? { docDir } : undefined)
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

/* ---------- mermaid 围栏 → 占位 div（Preview 异步渲染） ---------- */

const defaultFence: RendererRule =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const tok = tokens[idx]
  if (tok.info.trim().split(/\s+/)[0] !== 'mermaid') {
    return defaultFence(tokens, idx, options, env, self)
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

/** 解析标题树（跳过围栏代码块内的 #） */
export function parseOutline(src: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let fence: string | null = null
  for (const [i, raw] of src.split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+$/, '')
    const fenceMatch = /^(```+|~~~+).*$/.exec(line)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1].slice(0, 3)
      else if (line.startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    const m = /^(#{1,6})[ \t]+(.*)$/.exec(line)
    if (m) items.push({ level: m[1].length, text: m[2].trim(), line: i + 1 })
  }
  return items
}
