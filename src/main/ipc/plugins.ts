import { app, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginInfo, PluginManifest } from '@shared/types'

/**
 * 插件发现与装载（6.9）。渲染进程沙箱化（enableSandbox）没有 Node，
 * 主进程负责扫描插件目录、校验清单、把入口源码当字符串递给渲染层，
 * 由 pluginHost 在受控 `inkbox` API 下执行。插件与本应用同信任级
 * （用户手动放入自己机器的代码），但坏清单/坏代码必须被隔离展示，不能碍启动。
 *
 * 插件分两处来源：应用自带的**内置插件**（随包分发，builtin-plugins/，
 * 用户目录同名 id 可覆盖）与 userData/plugins/ 下的用户插件。
 */

/** 入口源码上限：插件是小工具，超过 256KB 视为异常不装载 */
const MAX_CODE_BYTES = 256 * 1024

export function pluginsRoot(): string {
  return join(app.getPath('userData'), 'plugins')
}

/** 内置插件目录：打包后取 resources/，开发期取项目根（out/main 的上两级） */
export function builtinRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'builtin-plugins')
    : join(__dirname, '..', '..', 'builtin-plugins')
}

/** 校验并解析一份 plugin.json；返回错误串表示清单不可用 */
function parseManifest(raw: string): { manifest: PluginManifest; error?: string } {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return { manifest: { id: '', name: '' }, error: 'plugin.json 不是合法 JSON' }
  }
  const m = (obj ?? {}) as Record<string, unknown>
  const id = typeof m.id === 'string' ? m.id.trim() : ''
  const name = typeof m.name === 'string' ? m.name.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return { manifest: { id, name }, error: '清单缺少合法 id（小写字母/数字/连字符）' }
  }
  if (!name) return { manifest: { id, name }, error: '清单缺少 name' }
  if (m.api !== undefined && m.api !== 1) {
    return { manifest: { id, name }, error: `不支持的宿主 API 版本：${String(m.api)}（当前 1）` }
  }
  const manifest: PluginManifest = {
    id,
    name,
    ...(typeof m.version === 'string' ? { version: m.version } : {}),
    ...(typeof m.description === 'string' ? { description: m.description } : {}),
    ...(typeof m.main === 'string' && m.main.trim() ? { main: m.main.trim() } : {}),
    api: 1
  }
  return { manifest }
}

/** 扫描单个根目录：每个子目录读一份 plugin.json，坏目录也以 error 形式呈现 */
function scanRoot(root: string, builtin: boolean): PluginInfo[] {
  if (!existsSync(root)) return []
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const out: PluginInfo[] = []
  for (const name of entries.sort()) {
    const dir = join(root, name)
    const mfPath = join(dir, 'plugin.json')
    if (!existsSync(mfPath)) {
      out.push({ dir, builtin, manifest: { id: '', name: name }, error: '缺少 plugin.json' })
      continue
    }
    let raw = ''
    try {
      raw = readFileSync(mfPath, 'utf-8')
    } catch (e) {
      out.push({ dir, builtin, manifest: { id: '', name: name }, error: `plugin.json 读取失败：${String(e)}` })
      continue
    }
    const { manifest, error } = parseManifest(raw)
    out.push({ dir, builtin, manifest, ...(error ? { error } : {}) })
  }
  return out
}

/** 扫描全部插件：内置在前、用户在后，用户目录同名 id 覆盖内置版 */
export function listPlugins(): PluginInfo[] {
  const byId = new Map<string, PluginInfo>()
  const unnamed: PluginInfo[] = []
  for (const [root, builtin] of [
    [builtinRoot(), true],
    [pluginsRoot(), false]
  ] as const) {
    for (const info of scanRoot(root, builtin)) {
      if (info.manifest.id && byId.has(info.manifest.id)) {
        byId.set(info.manifest.id, info) // 用户版覆盖内置版
      } else if (info.manifest.id) {
        byId.set(info.manifest.id, info)
      } else {
        unnamed.push(info) // 坏清单无 id，直接展示
      }
    }
  }
  return [...byId.values(), ...unnamed].sort((a, b) =>
    a.manifest.id.localeCompare(b.manifest.id)
  )
}

/** 读取插件入口源码。id 只用于在已扫描清单里匹配（绝不拼路径），入口名必须是目录内单文件 */
export function readPluginCode(id: string): string | null {
  const info = listPlugins().find((p) => p.manifest.id === id && !p.error)
  if (!info) return null
  const main = info.manifest.main ?? 'main.js'
  if (/[\\/]/.test(main) || main.startsWith('.')) return null
  try {
    const code = readFileSync(join(info.dir, main), 'utf-8')
    return code.length > MAX_CODE_BYTES ? null : code
  } catch {
    return null
  }
}

export function registerPluginsIpc(): void {
  ipcMain.handle('plugin:list', () => listPlugins())
  ipcMain.handle('plugin:readCode', (_e, id: unknown) =>
    typeof id === 'string' ? readPluginCode(id) : null
  )
  ipcMain.handle('plugin:openDir', async () => {
    const root = pluginsRoot()
    mkdirSync(root, { recursive: true })
    await shell.openPath(root)
  })
}
