import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown'
import { tags as t } from '@lezer/highlight'

/**
 * YAML front matter 解析（文档开头的 `---` 包围块）。
 * 没有它，lang-markdown 会把「title: x\ndate: y」段落 + 后续 `---` 误判成
 * setext 二级标题——heading 字号样式把这几行行高撑大 30%（窄窗口双栏下尤其扎眼）。
 *
 * 实现走 eager block parser（参考内置 FencedCode）：parse 一次吞完整个块。
 * 护栏：只认文档第一行（cx.lineStart === 0）；peek 到下一行是 --- 或无内容
 * （单行/双行 ---）则交还 HorizontalRule，不误吞水平分割线。
 */

const FM_MARKER = /^\s*---\s*$/

export const yamlFrontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'YAMLFrontmatter', block: true, style: t.meta },
    { name: 'YAMLFrontmatterMarker', style: t.processingInstruction }
  ],
  parseBlock: [
    {
      name: 'YAMLFrontmatter',
      before: 'HorizontalRule', // 必须排在水平线之前，否则 --- 首行永远被 HR 吃掉
      parse(cx: BlockContext, line: Line): boolean {
        if (cx.lineStart !== 0 || !FM_MARKER.test(line.text)) return false
        const peeked = cx.peekLine()
        if (!peeked || FM_MARKER.test(peeked)) return false
        const from = cx.lineStart
        const marks = [
          cx.elt('YAMLFrontmatterMarker', cx.lineStart + line.pos, cx.lineStart + line.text.length)
        ]
        for (;;) {
          if (!cx.nextLine()) break // EOF：未闭合也按已吞内容结块（仍好过 setext 误判）
          if (FM_MARKER.test(line.text)) {
            marks.push(
              cx.elt('YAMLFrontmatterMarker', cx.lineStart + line.pos, cx.lineStart + line.text.length)
            )
            cx.nextLine()
            break
          }
        }
        cx.addElement(cx.elt('YAMLFrontmatter', from, cx.prevLineEnd(), marks))
        return true
      }
    }
  ]
}
