/**
 * 可打开文档类型（工作区文件树、Quick Open、外部拖入、系统文件关联共用）。
 * 与 FileTreeNode 的 MD_EXT 保持一致：Markdown 系列与纯文本。
 */
export const OPENABLE_EXTS = ['.md', '.markdown', '.mdown', '.txt']

export function isOpenablePath(p: string): boolean {
  const lower = p.toLowerCase()
  return OPENABLE_EXTS.some((ext) => lower.endsWith(ext))
}
