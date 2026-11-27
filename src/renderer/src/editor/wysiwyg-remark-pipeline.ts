/**
 * 即显 remark 解析管线的单一来源。
 *
 * WysiwygEditor 挂编辑器与 services/content-equivalence 做「内容等价」比较
 * 都必须走同一份插件序列——比较器若与真实解析管线不同步，风格差异会在
 * 两边解析出不同的树，"打开即未保存"就会复发。新增解析插件时在这里追加，
 * 两端自动同步。
 */

import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import remarkGemoji from 'remark-gemoji'
import remarkFootnotes from 'remark-footnotes'
import remarkFrontmatter from 'remark-frontmatter'
import { guardMathText } from '@/editor/wysiwyg-math'
import { splitInlineMarks, tocBlock, mergeHtmlSpans, htmlTableBlock } from '@/editor/wysiwyg-extensions'

interface MdastNode {
  type?: string
  depth?: number
  alt?: unknown
  title?: unknown
  checked?: unknown
  value?: string
  children?: MdastNode[]
}

/** 图片 alt/title 的 null 归一化为空串（remark 对无 alt 产出 null，
 *  PM/序列化侧是 ''，不归一会造成打开即不等价） */
export function normalizeImageNulls() {
  return (tree: MdastNode): void => {
    const walk = (n: MdastNode): void => {
      if (n.type === 'image') {
        if (n.alt === null || n.alt === undefined) n.alt = ''
        if (n.title === null || n.title === undefined) n.title = ''
      }
      n.children?.forEach((c) => walk(c))
    }
    walk(tree)
  }
}

/** 空内容任务项修复：milkdown 内置 remark-gfm 的 tasklist 分词器要求复选框后
 *  跟非空白内容，`- [ ] `/`- [x] `（复选框在行尾，插入面板/输入规则的空任务项
 *  都是这个形态）解析成 checked:null + 字面文本 [ ]，模式往返后任务项退化为
 *  普通列表项。GFM 规范允许复选框后仅空白到行尾（预览侧 markdown-it 就能渲染
 *  出复选框），这里在 mdast 层对齐：listItem 无 checked 且首段文本恰为
 *  [ ]/[x]（可带尾随空白）时改写 checked 并清空该段文本。 */
export function repairEmptyTaskItems() {
  return (tree: MdastNode): void => {
    const walk = (n: MdastNode): void => {
      if (n.type === 'listItem' && (n.checked === null || n.checked === undefined)) {
        const first = n.children?.[0]
        if (first && first.type === 'paragraph') {
          const only = first.children
          if (only?.length === 1 && only[0].type === 'text' && typeof only[0].value === 'string') {
            const m = /^\[([ xX])\][ \t]*$/.exec(only[0].value)
            if (m) {
              n.checked = m[1].toLowerCase() === 'x'
              first.children = []
            }
          }
        }
      }
      n.children?.forEach((c) => walk(c))
    }
    walk(tree)
  }
}

/** 相邻有序列表分隔的哨兵（toWysiwygSource 注入的空一级标题）：
 *  remark 解析后移除，PM 文档与序列化输出里不留痕迹 */
export function dropSplitHeadings() {
  return (tree: MdastNode): void => {
    if (!tree.children) return
    tree.children = tree.children.filter(
      (c) => !(c.type === 'heading' && c.depth === 1 && (!c.children || c.children.length === 0))
    )
  }
}

/** 容器内孤立硬换行清理（存量文件）：remark-breaks 会把旧版序列化缺陷落盘的
 *  字面 `<br />` 解析成 break。`> <br />`（引用里只有一个 break）是空段落残渣
 *  （P15），不清掉则重开序列化不等价 → 打开即脏。列表项同族一并处理。 */
export function dropLoneBreakInContainers() {
  return (tree: MdastNode): void => {
    const walk = (n: MdastNode): void => {
      // 本插件在 remarkBreaks 之前运行：<br /> 此时是 html 节点，之后才是 break，
      // 两种形态都认（remark-breaks 缺席/顺序调整时不失效）
      const lone =
        n.children?.length === 1 &&
        (n.children[0].type === 'break' ||
          (n.children[0].type === 'html' && /^\s*<br\s*\/?>\s*$/i.test(String(n.children[0].value ?? ''))))
      if ((n.type === 'blockquote' || n.type === 'listItem') && lone) {
        // 换成空段落而不是清空 children：空容器会被 milkdown 整个丢弃，
        // 序列化少一块 → 与磁盘不等价（等于白修）
        n.children = [{ type: 'paragraph', children: [] }]
      }
      n.children?.forEach((c) => walk(c))
    }
    walk(tree)
  }
}

/** 与 WysiwygEditor 的 ctx.update(remarkPluginsCtx) 完全一致的插件序列。
 *  options 字段沿用 milkdown 约定（core 按 plug.plugin 取值 use） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wysiwygRemarkPlugins: { plugin: any; options: any }[] = [
  { plugin: normalizeImageNulls, options: {} },
  { plugin: repairEmptyTaskItems, options: {} },
  { plugin: dropLoneBreakInContainers, options: {} },
  { plugin: dropSplitHeadings, options: {} },
  { plugin: remarkBreaks, options: {} },
  // $...$ / $$...$$ → mdast inlineMath/math，由 wysiwyg-math 的 schema 接住
  { plugin: remarkMath, options: {} },
  // 误判护栏：货币/含空格的 $ 对还原为字面文本（与预览管线对齐，roundtrip 无损）
  { plugin: guardMathText, options: {} },
  // emoji 短代码 → 字符（纯文本替换，与预览 markdown-it-emoji 一致）
  { plugin: remarkGemoji, options: {} },
  // 脚注 [^1] + 定义 → footnoteReference/footnoteDefinition
  { plugin: remarkFootnotes, options: {} },
  // ==高亮== ^上标^ ~下标~ 文本切分 → 自定义 mdast 节点（mark schema 接住）
  { plugin: splitInlineMarks, options: {} },
  // YAML front matter → yaml 节点（yamlSchema 接住，序列化还原围栏）
  { plugin: remarkFrontmatter, options: 'yaml' },
  // 独占一段的 [TOC] → toc 块节点（tocView 实时渲染可点击目录）
  { plugin: tocBlock, options: {} },
  // 行内 HTML 白名单：<u>/<mark>/<kbd> 等配对标签 → htmlSpan mark
  { plugin: mergeHtmlSpans, options: {} },
  // 块级 HTML 表格白名单：完整 <table>…</table> 块 → htmlTable 节点（Typora
  // 语义：默认渲染，光标进入才显示源码；序列化原样回写）
  { plugin: htmlTableBlock, options: {} }
]
