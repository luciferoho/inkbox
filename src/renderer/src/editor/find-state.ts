import { reactive } from 'vue'
import type { FindQuery } from '@/find-shared'

/**
 * 查找条按「标签」共享（同一文档的 即显/编辑/双栏/预览 共用一份状态）：
 * 每个标签一个响应式槽位 {open, query, replace, active}，各编辑器双向绑定——
 * 本地 refs 变化推入槽位，槽位变化拉回本地（切模式/切标签/双栏两侧互相同步）。
 * 计数（总数）不入槽：各引擎恢复时按自身内容重算；active（当前第 x 个）入槽，
 * 切回来恢复原来的 x/x 显示（越界时钳到有效范围）。
 */
export interface FindTabState {
  open: boolean
  query: FindQuery
  replace: string
  /** 当前活动命中序号（0 基；-1 = 无）。恢复时钳到重算后的计数范围内 */
  active: number
}

const store = new Map<number, FindTabState>()

/** 取（或创建）标签的查找状态槽；tabId null（主页/无标签）归到 -1 槽 */
export function findState(tabId: number | null): FindTabState {
  const key = tabId ?? -1
  let s = store.get(key)
  if (!s) {
    s = reactive({
      open: false,
      query: { text: '', caseSensitive: false, regexp: false, wholeWord: false },
      replace: '',
      active: -1
    })
    store.set(key, s)
  }
  return s
}

export function sameQuery(a: FindQuery, b: FindQuery): boolean {
  return (
    a.text === b.text &&
    a.caseSensitive === b.caseSensitive &&
    a.regexp === b.regexp &&
    a.wholeWord === b.wholeWord
  )
}
