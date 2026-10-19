/**
 * 可打开文档类型（工作区文件树、Quick Open、外部拖入共用）。
 * 与 FileTreeNode 的 MD_EXT 保持一致：Markdown 系列与纯文本。
 * HTML 导入能力保留在 documents.openPath，但不作为拖入/快开的默认类型。
 */
export const OPENABLE_EXTS = ['.md', '.markdown', '.mdown', '.txt']

export function isOpenablePath(p: string): boolean {
  const lower = p.toLowerCase()
  return OPENABLE_EXTS.some((ext) => lower.endsWith(ext))
}
