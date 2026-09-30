import { EditorState } from '@codemirror/state'
import { currentLocale } from '@/i18n'

/**
 * CodeMirror 内置界面（搜索面板、跳转行对话框、替换提示）的文案。
 * 走官方 phrases 机制：key 必须与源码里的英文字符串完全一致（含大小写）。
 * `$` 是占位符（匹配数/行号），保留不译。
 * 英文即 CodeMirror 默认文案，返回空 phrases；随语言切换在 SourceEditor 里热替换。
 */
const ZH_PHRASES: Record<string, string> = {
  /* 搜索面板 */
  Find: '查找',
  Replace: '替换为',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则',
  'by word': '全字匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  /* 跳转行对话框（Ctrl+Alt+G） */
  'Go to line': '跳转到行',
  go: '跳转',
  /* 无障碍播报 */
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'current match': '当前匹配',
  'on line': '位于第'
}

/** 按当前语言取 phrases 扩展（放 Compartment 里可热切换） */
export function cmPhrases(): ReturnType<typeof EditorState.phrases.of> {
  return EditorState.phrases.of(currentLocale() === 'zh-CN' ? ZH_PHRASES : {})
}
