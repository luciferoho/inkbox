import type { Token } from 'markdown-it'
import { md } from './markdown'
import { parseImageLine } from '@/editor/image-utils'

/**
 * Markdown → LaTeX 导出（5.5，1.x 第八批）。
 * 复用预览的 markdown-it 实例（md.parse 含全部扩展规则：==高亮==/上下标/脚注/公式/任务列表/[TOC]），
 * 走 token 树生成 ctexart 文档。编译需 XeLaTeX（中文走 ctex），图片为相对路径引用
 * （.tex 与文档同目录时可直接编译；远程图片以链接占位）。
 */

/* ---------- 转义 ---------- */

/** 正文转义（单遍替换，避免二次转义）；代码/公式内容不过此函数 */
function esc(s: string): string {
  const map: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    '$': '\\$',
    '#': '\\#',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}'
  }
  return s.replace(/[\\&%$#_{}~^]/g, (c) => map[c])
}

/** URL 转义（hyperref 参数：% 与 # 必须转，其余保留可读性） */
function escUrl(s: string): string {
  return s.replace(/\\/g, '/').replace(/%/g, '\\%').replace(/#/g, '\\#')
}

/* ---------- 代码块语言映射（listings 内置语言的一小部分，未知则不着色） ---------- */

const LISTING_LANG: Record<string, string> = {
  python: 'Python',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  html: 'HTML',
  xml: 'XML',
  css: 'CSS',
  sql: 'SQL',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  makefile: 'make'
}

const SECTION = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph']

/* ---------- token 工具 ---------- */

/** children 纯文本（原文，含 | 修饰符） */
function renderAsText(children: Token[]): string {
  return children
    .map((t) => (t.type === 'text' || t.type === 'code_inline' ? t.content : renderAsText(t.children ?? [])))
    .join('')
}

/** markdown-it 对链接目标做过百分号编码：导出前解码回原始路径 */
function decodeUrl(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** 图片：本地路径 → includegraphics（按 alt 修饰符定宽/对齐）；远程 → 链接占位 */
function renderImage(tok: Token, notes: Map<string, string>): string {
  const src = decodeUrl(String(tok.attrGet('src') ?? ''))
  const alt = renderAsText(tok.children ?? [])
  const info = parseImageLine(`![${alt}](x)`)
  const altText = esc(info?.alt ?? alt)
  if (/^https?:\/\//i.test(src)) {
    return `\\href{${escUrl(src)}}{${altText || '\\texttt{' + escUrl(src) + '}'}}`
  }
  const opts: string[] = []
  const mods = info?.mods
  if (mods?.width && mods.width.endsWith('%')) {
    opts.push(`width=${(parseFloat(mods.width) / 100).toFixed(2)}\\linewidth`)
  } else if (mods?.width && mods.width.endsWith('px')) {
    opts.push(`width=${Math.round(parseFloat(mods.width) * 0.75)}pt`)
  }
  if (mods?.height && mods.height.endsWith('px')) {
    opts.push(`height=${Math.round(parseFloat(mods.height) * 0.75)}pt`)
  }
  // Windows 反斜杠路径 → 正斜杠；含空格路径用 {"..."} 包裹（graphicx 惯例）
  const path = src.replace(/\\/g, '/')
  const pathArg = path.includes(' ') ? `{"${path}"}` : `{${escUrl(path)}}`
  const img = `\\includegraphics${opts.length ? `[${opts.join(',')}]` : ''}${pathArg}`
  return mods?.align === 'center' ? `\n\\begin{center}\n${img}\n\\end{center}\n` : img
}

/* ---------- 行内渲染 ---------- */

function renderInline(children: Token[], notes: Map<string, string>): string {
  let out = ''
  for (const tok of children) {
    switch (tok.type) {
      case 'text':
        out += esc(tok.content)
        break
      case 'code_inline':
        out += `\\texttt{${esc(tok.content)}}`
        break
      case 'strong_open':
        out += '\\textbf{'
        break
      case 'strong_close':
        out += '}'
        break
      case 'em_open':
        out += '\\emph{'
        break
      case 'em_close':
        out += '}'
        break
      case 's_open':
        out += '\\sout{'
        break
      case 's_close':
        out += '}'
        break
      case 'mark_open':
        out += '\\hl{'
        break
      case 'mark_close':
        out += '}'
        break
      case 'sub_open':
        out += '\\textsubscript{'
        break
      case 'sub_close':
        out += '}'
        break
      case 'sup_open':
        out += '\\textsuperscript{'
        break
      case 'sup_close':
        out += '}'
        break
      case 'link_open':
        out += `\\href{${escUrl(decodeUrl(String(tok.attrGet('href') ?? '')))}}{`
        break
      case 'link_close':
        out += '}'
        break
      case 'image':
        out += renderImage(tok, notes)
        break
      case 'softbreak':
        out += ' '
        break
      case 'hardbreak':
        out += '\\\\\n'
        break
      case 'footnote_ref':
        out += `\\footnote{${notes.get(String(tok.meta?.id)) ?? ''}}`
        break
      case 'html_inline': {
        // 任务列表复选框（core 规则注入）/ 内联公式（meta.tex 存原文）
        if (tok.content.includes('task-item-checkbox')) {
          out += tok.content.includes('checked') ? '$\\boxtimes$ ' : '$\\square$ '
        } else if (tok.meta?.tex) {
          out += `$${tok.meta.tex}$`
        } else {
          out += esc(tok.content)
        }
        break
      }
      default: {
        // 未知容器：递归子节点；叶子：转义文本
        if (tok.children?.length) out += renderInline(tok.children, notes)
        else out += esc(tok.content)
      }
    }
  }
  return out
}

/* ---------- 块级渲染 ---------- */

function renderListing(tok: Token): string {
  const lang = tok.info.trim().split(/\s+/)[0] ?? ''
  const mapped = LISTING_LANG[lang.toLowerCase()]
  const opt = mapped ? `[language=${mapped}]` : ''
  return `\\begin{lstlisting}${opt}\n${tok.content}${tok.content.endsWith('\n') ? '' : '\n'}\\end{lstlisting}`
}

function renderTable(rows: Token[], notes: Map<string, string>): string {
  // rows 是 thead/tbody 内部：按 tr 分组
  const trs: Token[][] = []
  let cur: Token[] | null = null
  for (const tok of rows) {
    if (tok.type === 'tr_open') cur = []
    else if (tok.type === 'tr_close') {
      if (cur) trs.push(cur)
      cur = null
    } else if (cur) cur.push(tok)
  }
  if (trs.length === 0) return ''
  // 表头定义列数与对齐
  const aligns: string[] = []
  const headerCells: string[] = []
  for (const tok of trs[0]) {
    if (tok.type !== 'th_open') continue
    const style = String(tok.attrGet('style') ?? '')
    aligns.push(/center/.test(style) ? 'c' : /right/.test(style) ? 'r' : 'l')
  }
  // 无表头的表格（理论上 markdown-it 必有 thead）：按第一行列数兜底
  const colCount = aligns.length || trs[0].filter((t) => t.type === 'th_open' || t.type === 'td_open').length || 1
  const alignSpec = `|${Array.from({ length: colCount }, (_, i) => aligns[i] ?? 'l').join('|')}|`

  const renderRow = (tokens: Token[], cellOpen: string): string => {
    const cellClose = cellOpen.replace('_open', '_close')
    const cells: string[] = []
    let depth = 0
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.type === cellOpen) {
        depth = 1
        let j = i + 1
        while (j < tokens.length && depth > 0) {
          if (tokens[j].type === cellOpen) depth++
          else if (tokens[j].type === cellClose) depth--
          j++
        }
        // tokens[i+1] 是 inline；tokens[j-1] 是对齐 close
        const inline = tokens[i + 1]
        cells.push(inline ? renderInline(inline.children ?? [], notes) : '')
        i = j - 1
      }
    }
    while (cells.length < colCount) cells.push('')
    return `${cells.slice(0, colCount).join(' & ')} \\\\`
  }

  const headRow = renderRow(trs[0], 'th_open')
  const bodyRows = trs
    .slice(1)
    .map((tr) => renderRow(tr, 'td_open'))
    .join('\n\\hline\n')

  return [
    '\\begin{tabular}' + `{${alignSpec}}`,
    '\\hline',
    headRow,
    '\\hline',
    bodyRows,
    '\\hline',
    '\\end{tabular}'
  ].join('\n')
}

/** 脚注定义收集：footnote_block 内 footnote_open(meta.id)…footnote_close 的内容拍平成一行 */
function collectFootnotes(toks: Token[], notes: Map<string, string>): void {
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'footnote_open') continue
    let depth = 1
    let j = i + 1
    for (; j < toks.length && depth > 0; j++) {
      if (toks[j].type === 'footnote_open') depth++
      else if (toks[j].type === 'footnote_close') depth--
    }
    const inner = toks.slice(i + 1, j - 1)
    const rendered = renderBlocks(inner, notes)
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/([}%])$/, '$1')
    notes.set(String(toks[i].meta?.id), rendered)
    i = j - 1
  }
}

function renderBlocks(toks: Token[], notes: Map<string, string>): string {
  let out = ''
  let i = 0
  while (i < toks.length) {
    const tok = toks[i]
    switch (tok.type) {
      case 'heading_open': {
        const level = Number(tok.tag.slice(1)) || 1
        const inline = toks[i + 1]
        out += `\\${SECTION[Math.min(level, SECTION.length) - 1]}{${renderInline(inline?.children ?? [], notes)}}\n\n`
        i += 3
        continue
      }
      case 'paragraph_open': {
        out += renderInline(toks[i + 1]?.children ?? [], notes) + '\n\n'
        i += 3
        continue
      }
      case 'inline': {
        // 紧凑上下文（少见）：直接渲染
        out += renderInline(tok.children ?? [], notes) + '\n\n'
        i++
        continue
      }
      case 'fence':
      case 'code_block':
        out += renderListing(tok) + '\n\n'
        i++
        continue
      case 'luci_math_block':
        out += `\\[\n${tok.content}\n\\]\n\n`
        i++
        continue
      case 'bullet_list_open':
        out += '\\begin{itemize}\n'
        i++
        continue
      case 'bullet_list_close':
        out += '\\end{itemize}\n\n'
        i++
        continue
      case 'ordered_list_open':
        out += '\\begin{enumerate}\n'
        i++
        continue
      case 'ordered_list_close':
        out += '\\end{enumerate}\n\n'
        i++
        continue
      case 'list_item_open': {
        // 找配对 close，取出内部块单独渲染（首段紧贴 \item，嵌套列表自然落入）
        let depth = 1
        let j = i + 1
        for (; j < toks.length && depth > 0; j++) {
          if (toks[j].type === 'list_item_open') depth++
          else if (toks[j].type === 'list_item_close') depth--
        }
        const inner = toks.slice(i + 1, j - 1)
        out += renderListItem(inner, notes)
        i = j
        continue
      }
      case 'list_item_close':
        i++
        continue
      case 'blockquote_open':
        out += '\\begin{quote}\n'
        i++
        continue
      case 'blockquote_close':
        out += '\\end{quote}\n\n'
        i++
        continue
      case 'table_open': {
        let j = i
        while (j < toks.length && toks[j].type !== 'table_close') j++
        out += renderTable(toks.slice(i + 1, j), notes) + '\n\n'
        i = j + 1
        continue
      }
      case 'hr':
        out += '\\noindent\\rule{\\linewidth}{0.4pt}\n\n'
        i++
        continue
      case 'footnote_block_open': {
        // 脚注定义区不进正文（已收集，引用处内联 \footnote）
        let depth = 1
        let j = i + 1
        for (; j < toks.length && depth > 0; j++) {
          if (toks[j].type === 'footnote_block_open') depth++
          else if (toks[j].type === 'footnote_block_close') depth--
        }
        i = j
        continue
      }
      case 'luci_toc_block':
        out += '\\tableofcontents\n\n'
        i++
        continue
      case 'html_block': {
        // 其余 HTML 片段（html:false 下罕见）转义为文本
        out += esc(tok.content) + '\n\n'
        i++
        continue
      }
      default: {
        // 未知开/闭 token：跳过开闭壳，其他递归
        if (tok.type.endsWith('_open') || tok.type.endsWith('_close')) {
          i++
          continue
        }
        out += esc(tok.content) + '\n\n'
        i++
        continue
      }
    }
  }
  return out
}

/** 列表项：首段紧贴 \item（任务复选框由行内规则生成），其余块顺序展开 */
function renderListItem(toks: Token[], notes: Map<string, string>): string {
  let s = '\\item '
  let i = 0
  if (toks[0]?.type === 'paragraph_open') {
    s += renderInline(toks[1]?.children ?? [], notes)
    i = 3
  }
  const rest = toks.slice(i)
  if (rest.length) s += '\n' + renderBlocks(rest, notes)
  return s.trimEnd() + '\n'
}

const PREAMBLE = `% 由墨匣 Inkbox 导出 · 建议用 XeLaTeX 编译（中文依赖 ctex）
\\documentclass[UTF8,11pt]{ctexart}
\\usepackage[a4paper,margin=2.5cm]{geometry}
\\usepackage{graphicx}
\\usepackage{amsmath,amssymb}
\\usepackage[normalem]{ulem}
\\usepackage{xcolor}
\\usepackage{soul}
\\usepackage{listings}
\\usepackage[hidelinks]{hyperref}
\\setlength{\\parindent}{2em}

\\begin{document}
`

/** Markdown 源码 → 完整 LaTeX 文档 */
export function mdToLaTeX(src: string): string {
  const notes = new Map<string, string>()
  const tokens = md.parse(src, {})
  collectFootnotes(tokens, notes)
  const body = renderBlocks(tokens, notes).replace(/\n{3,}/g, '\n\n')
  return `${PREAMBLE}${body}\\end{document}\n`
}
