/**
 * 即显编辑器「保存前同步」注册表（2026-11-20 P14）。
 *
 * milkdown 的 markdownUpdated 监听有防抖：打完字立即保存时，saveTab 直读
 * store 的 tab.content 会截掉防抖中的最后一段输入（实测丢整段），磁盘与
 * 缓冲区从此不一致。WysiwygEditor 挂载时把「立即序列化当前文档」的函数
 * 注册进来，saveTab 写盘前先调用，把最新内容同步进 store 再写。
 */

const flushers = new Map<number, () => string | null>()

/** 挂载时注册；返回解绑函数（卸载时调用） */
export function registerWysiwygFlush(tabId: number, fn: () => string | null): () => void {
  flushers.set(tabId, fn)
  return () => {
    if (flushers.get(tabId) === fn) flushers.delete(tabId)
  }
}

/** 取该标签当前应有的内容；无挂载中的即显编辑器（源码模式/预览）返回 null */
export function flushWysiwyg(tabId: number): string | null {
  const fn = flushers.get(tabId)
  if (!fn) return null
  try {
    return fn()
  } catch {
    return null
  }
}
