/**
 * 代码块「复制」能力共用件：
 * - 图标（复制/已复制勾）
 * - 剪贴板写入（主进程剪贴板优先，见 services/clipboard）
 * - 复制成功反馈（按钮切勾 1.2s）
 * - document 级点击委托（md-preview 渲染管线的静态按钮用）
 * 使用方：services/markdown.ts（预览管线）、editor/pm-codeblock-chrome.ts（即显模式）
 */
import { writeClipboardRich, writeClipboardText } from '@/services/clipboard'

export const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'

export const COPIED_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'

/** 写纯文本（主进程剪贴板优先） */
export const writeClipboard = writeClipboardText

/** 写文本 + HTML（主进程剪贴板优先） */
export { writeClipboardRich }

/** 复制成功反馈：按钮切换为勾并标 is-copied，1.2s 还原 */
export function applyCopiedFeedback(btn: HTMLButtonElement, copiedTitle: string, copyTitle: string): void {
  btn.classList.add('is-copied')
  btn.innerHTML = COPIED_ICON
  btn.title = copiedTitle
  window.setTimeout(() => {
    btn.classList.remove('is-copied')
    btn.innerHTML = COPY_ICON
    btn.title = copyTitle
  }, 1200)
}
