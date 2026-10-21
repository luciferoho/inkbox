import { app, ipcMain, protocol, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type { ThemeInfo } from '@shared/types'

/** M3 主题生态（Typora 兼容）：
 *  - themes 根级或一级子目录内的 .css 都是主题（Typora 社区发布结构五花八门：
 *    根级 css + 同名资源夹 / 子目录 css + 子目录资源 / @import 拆分文件）
 *  - theme-resource:// 协议服务主题资源（字体/图片），CSS 里的相对 url 由渲染层重写
 *  - base.user.css 全局自定义样式
 *  变量约定：主题覆盖 --bg-color/--text-color/--primary-color 等 Typora 变量，
 *  渲染层做双向映射（见 services/theme-css.ts）。 */

export function themesDir(): string {
  return join(app.getPath('userData'), 'themes')
}

export function userCssPath(): string {
  return join(app.getPath('userData'), 'base.user.css')
}

/** 相对路径白名单：无盘符、无 ..、正斜杠分隔（themeCss 配置与协议同此校验） */
function safeRelPath(p: string): string | null {
  if (!/^[\w\-.][\w\-. \u4e00-\u9fff()（）]*((\/)[\w\-. \u4e00-\u9fff()（）]+)*\.css$/i.test(p)) return null
  if (p.includes('..')) return null
  return p
}

const README = `# Inkbox 主题目录

把 Typora 主题（.css 文件，可带同名资源文件夹）放进本目录即可在
设置 → 外观 → 主题样式中选择；子目录里的主题也会被发现。

兼容 Typora 约定：一个 CSS 文件 + 同名资源文件夹（字体/图片按相对路径引用）、
@import 拆分文件、:root 变量（--bg-color/--text-color/--primary-color/
--side-bar-bg-color/--code-bg-color 等）与 #write 正文容器选择器。
社区主题常用的内部类也能识别：.md-fences（代码块，不会误染 front matter）、
.md-table（表格）、.md-task-list-item（任务列表）、pre.md-meta-block（YAML
元信息块）、.cm-*（代码语法色，源码模式调色板自动排除）。
主题自定义根字号（如 html{font-size:14px}）会自动换算成等值 px，
rem 字号与 Typora 显示一致。

Inkbox 会把主题样式限制在文档内容区（不影响应用界面），并把常见 Typora
变量映射到应用主题色；示例见 example-paper.css。
`

const EXAMPLE = `/* 示例主题：暖褐纸面（演示令牌覆盖；复制一份改名即可做自己的主题） */
:root {
  --bg-color: #f3ece2;
  --side-bar-bg-color: #e6dbc9;
  --text-color: #3a2f24;
  --primary-color: #a8622a;
  --code-bg-color: #eee4d2;
  --border-color: #ddcfb8;
  --control-text-color: #8a7a64;
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

/** 主题变体后缀（Typora 社区通用命名）：paper/day/light=浅色，midnight/night/dark=深色，
 *  grey/gray=第三种中性风格。同族键去掉该后缀，变体键保留风格词 */
const VARIANT_SUFFIX: { re: RegExp; key: string; kind: ThemeInfo['variant'] }[] = [
  { re: /[-_.](dark|midnight|night|black)$/i, key: 'dark', kind: 'dark' },
  { re: /[-_.](light|paper|day|white|dawn)$/i, key: 'light', kind: 'light' },
  { re: /[-_.](grey|gray)$/i, key: 'grey', kind: 'other' }
]

function parseCssColor(v: string): [number, number, number] | null {
  const s = v.trim()
  const hex = s.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 4) {
      return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16)) as [number, number, number]
    }
    if (h.length >= 6) {
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
    }
  }
  const rgb = s.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const p = rgb[1].split(/[,\s/]+/).map(Number)
    if (p.length >= 3 && p.slice(0, 3).every((n) => Number.isFinite(n))) return [p[0], p[1], p[2]]
  }
  return null
}

/** 变体判定：文件名后缀最可靠；否则依次看
 *  1) --bg-color/--bg-color1/--bg-page/--bg 变量（nord 用 --bg-color1 这类带号命名）
 *  2) html/body 规则里的 background 声明（newsprint/vue 只给 body 底色不给变量）
 *  无后缀的主题按亮度归入 light/dark（用于与同族 dark/light 文件配对）。 */
function detectVariant(name: string, absPath: string): { variant: ThemeInfo['variant']; variantKey: string } {
  const suffixed = VARIANT_SUFFIX.find((s) => s.re.test(name))
  if (suffixed) return { variant: suffixed.kind, variantKey: suffixed.key }
  try {
    const css = readFileSync(absPath, 'utf-8').slice(0, 200_000)
    const pick = (v: string | undefined): [number, number, number] | null =>
      v ? parseCssColor(v) : null
    const m = css.match(/--(?:bg-color\d*|bg-page|bg)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i)
    let c = pick(m?.[1])
    if (!c) {
      const bm = css.match(
        /(?:^|[}\n])\s*(?:html[\s,]*)?body\b[^{}]*\{[^}]*?background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i
      )
      c = pick(bm?.[1])
    }
    if (c) {
      const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
      const kind: ThemeInfo['variant'] = lum > 0.5 ? 'light' : 'dark'
      return { variant: kind, variantKey: kind }
    }
  } catch {
    /* 读取失败按 light 处理 */
  }
  return { variant: 'light', variantKey: 'light' }
}

/** 同族键：去掉变体后缀（dark/midnight/paper/grey…）。单文件主题 family = name */
function familyOf(name: string): string {
  const hit = VARIANT_SUFFIX.find((s) => s.re.test(name))
  return hit ? name.replace(hit.re, '') || name : name
}

/** 递归发现主题：根级 *.css + 一级子目录内的 *.css。
 *  跳过隐藏/系统目录（__MACOSX 等）。同名时根级优先（Typora 根级约定）。 */
export function scanThemes(): ThemeInfo[] {
  const dir = themesDir()
  if (!existsSync(dir)) return []
  const out = new Map<string, ThemeInfo>()
  const consider = (relFile: string, rootFirst: boolean): void => {
    const name = relFile.split('/').pop()!.replace(/\.css$/i, '')
    if (!name || name.startsWith('.')) return
    if (!out.has(name) || rootFirst) {
      const v = detectVariant(name, join(dir, relFile))
      out.set(name, {
        name,
        file: relFile,
        family: familyOf(name),
        variant: v.variant,
        variantKey: v.variantKey
      })
    }
  }
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.css')) {
        consider(entry.name, true)
      } else if (entry.isDirectory()) {
        let sub: string[]
        try {
          sub = readdirSync(join(dir, entry.name))
        } catch {
          continue
        }
        for (const f of sub) {
          if (f.startsWith('.') || !f.toLowerCase().endsWith('.css')) continue
          consider(`${entry.name}/${f}`, false)
        }
      }
    }
  } catch {
    return []
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** 主题名 → 当前实际文件（重扫描；配置里只存 name，文件挪目录不受影响） */
export function resolveThemeFile(name: string): string | null {
  if (!name) return null
  return scanThemes().find((t) => t.name === name)?.file ?? null
}

/* ---------- theme-resource:// 资源协议（字体/图片等相对 url 引用） ---------- */

const MIME: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css'
}

/** 解析协议 URL 里的相对路径并校验不越出 themes 目录 */
function resolveResourcePath(urlPath: string): string | null {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath.replace(/^\/+/, ''))
  } catch {
    return null
  }
  if (!rel || rel.includes('..') || rel.includes(':') || rel.includes('\\')) return null
  const abs = normalize(join(themesDir(), rel))
  const root = normalize(themesDir())
  if (!abs.startsWith(root + sep)) return null
  return abs
}

/** 资源路径兜底：主题发布包里资源夹被改名/移位、字体扩展名写错都很常见
 *  （如 css 引用 kiro-dark/x.ttf 而实际目录叫 kiro/，或 .ttf 实为 .otf）。
 *  精确路径缺失时在「该主题自己的目录」内找唯一同名/同主名资源；
 *  不跨主题匹配（避免 A 主题的字体串到 B 主题），仍越不出 themes 根。 */
const FONT_EXTS = ['.ttf', '.otf', '.woff', '.woff2', '.eot']
function findResourceFallback(rel: string): string | null {
  const base = decodeURIComponent(rel).split('/').pop()
  if (!base) return null
  const first = rel.replace(/^\/+/, '').split('/')[0]
  const searchRoot = first && first !== base ? join(themesDir(), first) : themesDir()
  if (!existsSync(searchRoot)) return null
  const stemOf = (name: string): string => name.replace(/\.[^.]+$/, '').toLowerCase()
  const baseLower = base.toLowerCase()
  const stem = stemOf(base)
  const isFont = FONT_EXTS.includes(base.slice(base.lastIndexOf('.')).toLowerCase())
  const exact: string[] = []
  const loose: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || exact.length > 1) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.toLowerCase() === baseLower) exact.push(p)
      else if (isFont && stemOf(e.name) === stem && FONT_EXTS.includes(e.name.slice(e.name.lastIndexOf('.')).toLowerCase())) {
        loose.push(p)
      }
      if (exact.length > 1) return
    }
  }
  walk(searchRoot, 0)
  if (exact.length === 1) return exact[0]
  return loose.length === 1 ? loose[0] : null
}

export function registerThemeResourceProtocol(): void {
  protocol.handle('theme-resource', async (request) => {
    const u = new URL(request.url)
    if (u.host !== 't' && u.host !== '') {
      return new Response('bad host', { status: 400 })
    }
    const requested = resolveResourcePath(u.pathname)
    if (!requested) return new Response('bad path', { status: 400 })
    const abs = existsSync(requested) ? requested : findResourceFallback(u.pathname)
    if (!abs || !existsSync(abs)) return new Response('not found', { status: 404 })
    const mime = MIME[abs.slice(abs.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream'
    try {
      const buf = readFileSync(abs)
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': mime,
          // 渲染层导出管线要 fetch 资源内联 data URL（页面与该协议跨源，需放行 CORS）
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache'
        }
      })
    } catch {
      return new Response('read failed', { status: 500 })
    }
  })
}

/* ---------- IPC ---------- */

export function registerThemesIpc(): void {
  ipcMain.handle('theme:list', (): ThemeInfo[] => scanThemes())

  ipcMain.handle('theme:readCss', (_e, file: string): string | null => {
    const rel = safeRelPath(file)
    if (!rel) return null
    const p = join(themesDir(), rel)
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
