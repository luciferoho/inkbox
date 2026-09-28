declare module 'turndown-plugin-gfm' {
  /** GFM 插件集：表格 / 删除线 / 任务列表（无官方类型，手写声明） */
  export function gfm(turndownService: unknown): void
  export function tables(turndownService: unknown): void
  export function strikethrough(turndownService: unknown): void
  export function taskListItems(turndownService: unknown): void
}
