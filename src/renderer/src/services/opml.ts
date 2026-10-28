import { parseOutline } from './markdown'

/**
 * OPML 导出（3.5）：大纲（标题层级）→ OPML 2.0 XML，供 Workflowy/MindNode
 * 等大纲工具导入。仅取标题骨架（与侧栏大纲同源），不携带正文。
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface OpmlNode {
  text: string
  children: OpmlNode[]
}

function buildTree(md: string): OpmlNode[] {
  const roots: OpmlNode[] = []
  const stack: { level: number; node: OpmlNode }[] = []
  for (const it of parseOutline(md)) {
    const node: OpmlNode = { text: it.text, children: [] }
    while (stack.length > 0 && stack[stack.length - 1]!.level >= it.level) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1]!.node.children.push(node)
    stack.push({ level: it.level, node })
  }
  return roots
}

function renderNodes(nodes: OpmlNode[], indent: string, out: string[]): void {
  for (const n of nodes) {
    if (n.children.length === 0) {
      out.push(`${indent}<outline text="${esc(n.text)}"/>`)
    } else {
      out.push(`${indent}<outline text="${esc(n.text)}">`)
      renderNodes(n.children, indent + '  ', out)
      out.push(`${indent}</outline>`)
    }
  }
}

export function mdToOPML(title: string, md: string): string {
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push('<opml version="2.0">')
  out.push('  <head>')
  out.push(`    <title>${esc(title)}</title>`)
  out.push('    <ownerName>Inkbox</ownerName>')
  out.push('  </head>')
  out.push('  <body>')
  renderNodes(buildTree(md), '    ', out)
  out.push('  </body>')
  out.push('</opml>')
  return out.join('\n')
}
