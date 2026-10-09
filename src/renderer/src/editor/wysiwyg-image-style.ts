import { imageSchema, imageAttr } from '@milkdown/kit/preset/commonmark'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { parseAltMods, modsToStyle } from './image-utils'

/**
 * 即显图片修饰符渲染（副作用模块,由 WysiwygEditor 导入一次）：
 * `![alt|60%|center](src)` 的宽度/对齐修饰此前只在预览/导出生效,
 * 此处经 extendSchema 包装 image 的 toDOM,让即显所见即所得同步生效;
 * 序列化（toMarkdown）读 attrs 原值,不受渲染包装影响。
 * 输出的 alt 为剥离修饰后的干净文本（可访问性）,attrs 保留原文（序列化需要）。
 */
export const styledImageSchema = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    toDOM: (node: PMNode) => {
      const { mods, clean } = parseAltMods(String(node.attrs.alt ?? ''))
      const style = modsToStyle(mods)
      return [
        'img',
        {
          ...ctx.get(imageAttr.key)(node),
          ...node.attrs,
          alt: clean,
          ...(style ? { style } : {})
        }
      ]
    }
  }
})
