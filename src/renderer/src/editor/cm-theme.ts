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
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border)'
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid var(--border)'
  },
  /* 查找替换面板：flex 布局 + 设计令牌配色，明暗主题通用（颜色全走 CSS 变量） */
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px 8px',
    /* 右侧留出绝对定位的关闭按钮 */
    padding: '10px 44px 10px 14px'
  },
  /* 默认样式里 <br> 强制换行，flex 下交给 wrap */
  '.cm-panel.cm-search br': {
    display: 'none'
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    margin: '0',
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    color: 'var(--text)',
    backgroundColor: 'var(--surface-2)',
    /* CM 默认给 .cm-button 叠了一层浅色渐变 background-image，
       只改 background-color 盖不掉它，暗色下会剩一块浅色 */
    backgroundImage: 'none',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '4px 10px'
  },
  '.cm-panel.cm-search input': {
    width: '220px'
  },
  '.cm-panel.cm-search input:focus': {
    outline: 'none',
    borderColor: 'var(--accent)'
  },
  /* 复选框：还原原生渲染 + accent 着色（带 color-scheme 后暗色正常），
     否则会套用文本框样式变成一个带边框圆角的怪异方块 */
  ".cm-panel.cm-search input[type='checkbox']": {
    width: '14px',
    height: '14px',
    margin: '0',
    padding: '0',
    border: 'none',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    accentColor: 'var(--accent)',
    cursor: 'pointer'
  },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    margin: '0',
    fontSize: '12px',
    color: 'var(--text-2)',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none'
  },
  '.cm-panel.cm-search button': {
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s'
  },
  '.cm-panel.cm-search button:hover': {
    borderColor: 'var(--accent)'
  },
  /* 关闭 ×：绝对定位右上角，弱化为幽灵按钮（默认样式会叠在按钮行上方） */
  ".cm-panel.cm-search button[name='close']": {
    position: 'absolute',
    top: '50%',
    right: '8px',
    transform: 'translateY(-50%)',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-2)',
    fontSize: '16px',
    lineHeight: '1',
    padding: '4px 8px',
    borderRadius: '5px'
  },
  ".cm-panel.cm-search button[name='close']:hover": {
    color: 'var(--text)',
    backgroundColor: 'var(--surface-2)'
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
