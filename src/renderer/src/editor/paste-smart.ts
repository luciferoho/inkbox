/**
 * 即显侧「智能粘贴」注册点（正文右键菜单 / 表格右键菜单共用）。
 *
 * Ctrl+V 走 DOM paste 管线：TSV → 建表/填格，多行 Markdown → 解析成节点。
 * 右键菜单里的「粘贴」读的是 `navigator.clipboard.readText()`，没有 DOM 事件可复用，
 * 原先两处都直接 `tr.insertText()` 纯文本插入——复制出来的表格粘进去只是一堆
 * 竖线文本（回写到 Markdown 还会被转义成 `\|`），与 Ctrl+V 行为不一致。
 *
 * WysiwygEditor 挂载时把组件内的同一套解析函数注册进来，两个菜单在插入前先问一次；
 * 返回 false（普通文本、代码块内）时调用方仍退回纯文本插入。
 */
import type { EditorView as PmView } from '@milkdown/kit/prose/view'

export type PmSmartPaste = (view: PmView, text: string) => boolean

let pmSmartPaste: PmSmartPaste | null = null

export function registerPmSmartPaste(fn: PmSmartPaste | null): void {
  pmSmartPaste = fn
}

/** 尝试按结构化方式粘贴；false = 不接管，调用方走纯文本插入 */
export function tryPmSmartPaste(view: PmView, text: string): boolean {
  return pmSmartPaste ? pmSmartPaste(view, text) : false
}
