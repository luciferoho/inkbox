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
import { splitInlineMarks, tocBlock, mergeHtmlSpans } from '@/editor/wysiwyg-extensions'

interface MdastNode {
  type?: string
  depth?: number
  alt?: unknown
  title?: unknown
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

/** 与 WysiwygEditor 的 ctx.update(remarkPluginsCtx) 完全一致的插件序列。
 *  options 字段沿用 milkdown 约定（core 按 plug.plugin 取值 use） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const wysiwygRemarkPlugins: { plugin: any; options: any }[] = [
  { plugin: normalizeImageNulls, options: {} },
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
  { plugin: mergeHtmlSpans, options: {} }
]
