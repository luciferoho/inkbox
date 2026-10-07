import type { PluginCommand, PluginInfo } from '@shared/types'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'

/**
 * 插件宿主（6.9）。渲染进程沙箱化，插件以「主进程读出的源码字符串 +
 * new Function 执行」方式装载，唯一入口是受控 `inkbox` API：
 *   inkbox.registerCommand({ id, title, run })  注入命令（快捷键面板「插件」组）
 *   inkbox.getActiveDoc()                       当前文档 { name, path, content } | null
 *   inkbox.setContent(text)                     替换当前文档内容（内存态，标脏可撤销链）
 *   inkbox.showToast(msg)                       应用角标提示
 * 信任模型：插件是用户主动放进自己机器的代码，与本应用同权限（能拿到 window.api）；
 * 宿主的责任是隔离故障——单个插件抛错只标记该插件 error，绝不影响应用与其他插件。
 */

interface PluginInstance {
  info: PluginInfo
  disposers: (() => void)[]
}

/** 已激活插件：id → 实例（含清理钩子） */
const instances = new Map<string, PluginInstance>()
/** 已注册命令：全局 id → run（快捷键面板点击时查此表执行） */
const commands = new Map<string, { run: () => void; pluginId: string }>()

function markError(id: string, error: string): void {
  const ui = useUiStore()
  ui.pluginErrors = { ...ui.pluginErrors, [id]: error }
}

/** 构造一份面向单个插件的受控 API。所有回调都套 try/catch，插件崩溃不出宿主 */
function makeApi(info: PluginInfo, disposers: (() => void)[]): object {
  const pid = info.manifest.id
  const safe = (fn: () => void): void => {
    try {
      fn()
    } catch (e) {
      markError(pid, String(e instanceof Error ? e.message : e))
    }
  }
  return {
    registerCommand(cmd: { id: string; title: string; run: () => void }): void {
      const cid = typeof cmd?.id === 'string' ? cmd.id.trim() : ''
      const title = typeof cmd?.title === 'string' ? cmd.title.trim() : ''
      if (!cid || !title || typeof cmd?.run !== 'function') {
        throw new Error('registerCommand 需要 { id, title, run }')
      }
      const full: PluginCommand = { id: `plugin:${pid}/${cid}`, title, plugin: info.manifest.name }
      commands.set(full.id, { run: () => safe(cmd.run), pluginId: pid })
      useUiStore().upsertPluginCommand(full)
      disposers.push(() => {
        commands.delete(full.id)
        useUiStore().removePluginCommand(full.id)
      })
    },
    getActiveDoc(): { name: string; path: string | null; content: string } | null {
      const a = useDocumentsStore().active
      if (!a) return null
      return { name: a.name, path: a.path, content: a.content }
    },
    setContent(text: string): boolean {
      const docs = useDocumentsStore()
      const a = docs.active
      if (!a || a.isHome || typeof text !== 'string') return false
      docs.updateContent(a.id, text)
      // store→编辑器是单向流：通知整档重新同步，插件改动即刻可见
      useUiStore().notifyReload()
      return true
    },
    showToast(msg: string): void {
      useUiStore().showToast(String(msg))
    }
  }
}

function deactivateAll(): void {
  const ui = useUiStore()
  for (const inst of instances.values()) {
    for (const d of inst.disposers) {
      try {
        d()
      } catch {
        /* 清理钩子出错也继续 */
      }
    }
  }
  instances.clear()
  ui.pluginErrors = {}
}

/**
 * 重扫插件目录并按 config.plugins.disabled 重新装载。
 * 设置页「重新加载」、开关切换、以及任一窗口配置广播都会走到这里。
 */
export async function syncPlugins(): Promise<void> {
  const ui = useUiStore()
  let list: PluginInfo[] = []
  try {
    list = await window.api.plugin.list()
  } catch {
    return // 主进程不可达（罕见）：保持现状，不打扰用户
  }
  ui.plugins = list
  deactivateAll()
  for (const info of list) {
    const pid = info.manifest.id
    if (info.error || !pid) continue
    if (ui.pluginsDisabled.includes(pid)) continue
    try {
      const code = await window.api.plugin.readCode(pid)
      if (code === null) {
        markError(pid, '入口文件缺失或超过 256KB')
        continue
      }
      const disposers: (() => void)[] = []
      // 函数体形式执行：插件代码里直接调 inkbox.registerCommand(...) 即完成注册
      new Function('inkbox', `"use strict";\n${code}`)(makeApi(info, disposers))
      instances.set(pid, { info, disposers })
    } catch (e) {
      markError(pid, String(e instanceof Error ? e.message : e))
    }
  }
}

/** 执行一条插件命令（快捷键面板点击）。命令不存在（插件刚被禁用）静默忽略 */
export function runPluginCommand(id: string): void {
  const entry = commands.get(id)
  if (!entry) return
  entry.run()
}
