import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * 应用主题：颜色全部走设计令牌 CSS 变量，
 * 明暗模式由根节点 [data-theme] 切换，无需 Compartment 重配。
 */
const luciBase = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--text)',
    height: '100%'
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--editor-font-size, 13.5px)',
    lineHeight: 'var(--editor-line-height, 1.75)'
  },
  '.cm-content': {
    padding: '16px 6px 40vh 6px',
    caretColor: 'var(--accent)',
    minHeight: '100%'
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-2)',
    border: 'none',
    opacity: '0.6',
    minWidth: '38px'
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--surface-2) 55%, transparent)'
  },
  '.cm-activeLineGutter': {
    color: 'var(--accent)',
    opacity: '1',
    backgroundColor: 'transparent'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--accent-soft) !important'
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--accent-soft)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--accent-soft)',
    outline: '1px solid var(--accent)'
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)'
  },
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    borderColor: 'var(--border)'
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    color: 'var(--text)',
    backgroundColor: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '3px 7px'
  },
  '.cm-panel.cm-search label': {
    fontSize: '12px',
    color: 'var(--text-2)'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '6px'
  }
})

const luciHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '700', color: 'var(--text)', lineHeight: '1.4' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '700', color: 'var(--text)' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600', color: 'var(--text)' },
  { tag: t.heading4, fontSize: '1.05em', fontWeight: '600', color: 'var(--text)' },
  { tag: [t.heading5, t.heading6], fontWeight: '600', color: 'var(--text-2)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-2)' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, color: '#a85a32' },
  { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--text-2)' },
  { tag: t.contentSeparator, color: 'var(--accent)' },
  { tag: t.invalid, color: 'var(--danger)' }
])

export const luciTheme = [luciBase, syntaxHighlighting(luciHighlight)]
