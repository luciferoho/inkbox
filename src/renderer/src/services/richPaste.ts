import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

/**
 * 富文本粘贴 → Markdown（源码模式）：
 * 从网页/Office 复制的内容带 text/html 载荷，粘贴时转换为 Markdown。
 * 纯文本复制（text/plain 已是目标内容）不走此路径，由编辑器默认粘贴。
 */

let service: TurndownService | null = null

function svc(): TurndownService {
  if (!service) {
    service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined'
    })
    service.use(gfm) // 表格 / 删除线 / 任务列表
    // 空段落与纯装饰节点直接丢弃，避免产出成排的 &nbsp;
    service.remove(['style', 'script', 'noscript', 'meta', 'link'])
  }
  return service
}

/** HTML → Markdown；转换失败或结果为空返回 null（调用方回退默认粘贴） */
export function htmlToMarkdown(html: string): string | null {
  try {
    const md = svc().turndown(html).trim()
    return md || null
  } catch {
    return null
  }
}
