/**
 * 富文本粘贴 → Markdown（源码模式）：
 * 从网页/Office 复制的内容带 text/html 载荷，粘贴时转换为 Markdown。
 * 纯文本复制（text/plain 已是目标内容）不走此路径，由编辑器默认粘贴。
 *
 * turndown 全家桶只在首次转换时动态加载（不进启动包）；两个入口：
 * 源码编辑器的富文本粘贴、导入 .html 文件（documents.importHtml）。
 */

interface TurndownService {
  use: (plugins: unknown) => TurndownService
  remove: (tags: string[]) => TurndownService
  turndown: (html: string) => string
}

type TurndownCtor = new (options: Record<string, unknown>) => TurndownService

let loader: Promise<TurndownService | null> | null = null

/** 惰性构建转换器（turndown + GFM 插件 + 噪声标签剔除）。
 *  turndown 是 export = 的 CJS 包：动态导入后 default 与模块本体在不同打包形态下二选一 */
function loadService(): Promise<TurndownService | null> {
  loader ??= Promise.all([import('turndown'), import('turndown-plugin-gfm')])
    .then(([t, g]) => {
      const mod = t as unknown as { default?: unknown }
      const Ctor = (mod.default ?? t) as TurndownCtor
      const svc = new Ctor({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*',
        strongDelimiter: '**',
        linkStyle: 'inlined'
      })
      const gfmMod = g as unknown as { gfm?: unknown }
      svc.use(gfmMod.gfm) // 表格 / 删除线 / 任务列表
      // 空段落与纯装饰节点直接丢弃，避免产出成排的 &nbsp;
      svc.remove(['style', 'script', 'noscript', 'meta', 'link'])
      return svc
    })
    .catch((err) => {
      console.error('[richPaste] turndown load failed:', err)
      return null
    })
  return loader
}

/** HTML → Markdown；转换失败或结果为空返回 null（调用方回退默认粘贴） */
export async function htmlToMarkdown(html: string): Promise<string | null> {
  const svc = await loadService()
  if (!svc) return null
  try {
    const md = svc.turndown(html).trim()
    return md || null
  } catch {
    return null
  }
}
