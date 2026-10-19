import { Plugin } from '@milkdown/kit/prose/state'

/**
 * 粘贴 URL 到选区 → 自动生成 [选中文本](URL)（ROADMAP 2.10）。
 * URL 判定与链接文本清洗为源码（CodeMirror）/即显（ProseMirror）两编辑器共用；
 * PM 插件只处理"有选区 + 纯文本为单个 http(s) URL"的粘贴，无选区或非 URL
 * 一律返回 false 走默认粘贴。
 */

/** 纯文本是否为单个 http(s) URL（无空白字符） */
export function isHttpUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(text.trim())
}

/** 选区文本作为链接文本：换行折叠为空格（markdown 行内链接文本惯例） */
export function linkTextFromSelection(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 即显侧粘贴 URL 插件：选区非空时把选区包成链接 */
export function createPasteLinkPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
        if (!isHttpUrl(text)) return false
        const { state } = view
        const { from, to, empty } = state.selection
        if (empty) return false
        const mark = state.schema.marks.link?.create({ href: text })
        if (!mark) return false
        const linkText = linkTextFromSelection(state.doc.textBetween(from, to, ' '))
        if (!linkText) return false
        const tr = state.tr
        tr.replaceWith(from, to, state.schema.text(linkText, [mark]))
        // 粘贴后光标落在链接内继续输入会延续 link mark，显式清掉
        tr.removeStoredMark(mark)
        view.dispatch(tr.scrollIntoView())
        return true
      }
    }
  })
}
