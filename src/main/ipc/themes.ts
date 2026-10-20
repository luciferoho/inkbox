import { app, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThemeInfo } from '@shared/types'

/** M3 主题生态：userData/themes/*.css 外部主题 + userData/base.user.css 全局自定义样式。
 *  主题约定：一个 CSS 文件覆盖设计令牌（--bg/--surface/--text/--accent…），
 *  兼容常见 Typora 变量名（--bg-color/--text-color/--primary-color 等，渲染层做映射）。 */

export function themesDir(): string {
  return join(app.getPath('userData'), 'themes')
}

export function userCssPath(): string {
  return join(app.getPath('userData'), 'base.user.css')
}

/** 文件名白名单：只允许不含路径分隔符的普通名（防目录穿越），themeCss 配置同此校验 */
function safeName(name: string): string | null {
  return /^[^\\/\x00:]{1,128}\.css$/.test(name) ? name : null
}

const README = `# Inkbox 主题目录

把任意 .css 文件放进本目录，即可在 设置 → 外观 → 主题样式 中选择。

约定：覆盖 Inkbox 的设计令牌（CSS 变量），常用令牌：
  --bg / --bg-rail / --surface / --surface-2 / --border
  --text / --text-2 / --accent / --accent-strong / --accent-soft
  --code-bg / --code-fg / --selection / --danger / --ok
以及字体令牌 --font-ui / --font-mono。

兼容 Typora 主题变量：--bg-color、--side-bar-bg-color、--text-color、
--primary-color、--code-bg-color 等会自动映射到上面对应令牌。

示例见 example-paper.css。
`

const EXAMPLE = `/* 示例主题：暖褐纸面（演示令牌覆盖；复制一份改名即可做自己的主题） */
:root {
  --bg: #f3ece2;
  --bg-rail: #e6dbc9;
  --surface: #fbf7f0;
  --surface-2: #efe6d6;
  --border: #ddcfb8;
  --text: #3a2f24;
  --text-2: #8a7a64;
  --accent: #a8622a;
  --accent-strong: #8c4e1e;
  --accent-soft: rgba(168, 98, 42, 0.12);
  --selection: rgba(88, 130, 190, 0.45);
  --code-bg: #eee4d2;
  --code-fg: #3a2f24;
}
[data-theme='dark'] {
  --bg: #201a14;
  --bg-rail: #17120d;
  --surface: #2a221a;
  --surface-2: #362c21;
  --border: #40352a;
  --text: #e8ddcb;
  --text-2: #ab9c85;
  --accent: #d9924e;
  --accent-strong: #e8a767;
  --accent-soft: rgba(217, 146, 78, 0.15);
  --code-bg: #241d15;
  --code-fg: #e8ddcb;
}
`

/** 首次打开目录时放入说明与示例主题 */
function ensureThemesDir(): string {
  const dir = themesDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'README.md'), README, 'utf-8')
    writeFileSync(join(dir, 'example-paper.css'), EXAMPLE, 'utf-8')
  }
  return dir
}

export function registerThemesIpc(): void {
  ipcMain.handle('theme:list', (): ThemeInfo[] => {
    const dir = themesDir()
    if (!existsSync(dir)) return []
    try {
      return readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.css'))
        .map((f) => ({ name: f.slice(0, -4), file: f }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })

  ipcMain.handle('theme:readCss', (_e, file: string): string | null => {
    const name = safeName(file)
    if (!name) return null
    const p = join(themesDir(), name)
    if (!existsSync(p)) return null
    try {
      return readFileSync(p, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('theme:openDir', async (): Promise<void> => {
    await shell.openPath(ensureThemesDir())
  })

  ipcMain.handle('userCss:path', (): string => userCssPath())

  ipcMain.handle('userCss:read', (): string => {
    const p = userCssPath()
    return existsSync(p) ? readFileSync(p, 'utf-8') : ''
  })

  /** 打开（不存在则创建空文件）用户样式表，方便直接编辑 */
  ipcMain.handle('userCss:open', async (): Promise<void> => {
    const p = userCssPath()
    if (!existsSync(p)) writeFileSync(p, '/* 全局自定义样式：对所有窗口与文档生效 */\n', 'utf-8')
    await shell.openPath(p)
  })
}
