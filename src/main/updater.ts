import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import type { UpdateStatePayload } from '@shared/types'
import { markUpdateRestartPending } from './session'

/**
 * 更新控制器（单源状态机）：
 * - 发现新版本不自动下载（autoDownload=false），弹窗由用户决定；
 *   Release notes 含「强制更新 / force-update」标记时视为强制更新：
 *   立即自动下载，且更新弹窗不可关闭
 * - 下载进度经 update:state 全量广播到所有窗口（右上角图标/弹窗共用状态）
 * - 增量更新由 electron-updater 依据 .blockmap 自动完成，无需额外处理
 * - 安装前由渲染层落盘未保存内容，主进程写入更新重启标记 →
 *   重装后首次启动按恢复路径还原未保存内容与标签（见 session.ts）
 */

type Phase = UpdateStatePayload['phase']

let state: UpdateStatePayload = {
  phase: 'idle',
  version: '',
  notes: '',
  percent: 0,
  bps: 0,
  force: false,
  error: '',
  releaseDate: ''
}

let autoUpdater: AppUpdater | null = null
let listenersAttached = false

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:state', state)
  }
}

function patch(p: Partial<UpdateStatePayload>): void {
  state = { ...state, ...p }
  broadcast()
}

/** electron-updater 的 releaseNotes 可能是 string 或分段数组，归一为 markdown 文本 */
/** 语义化版本比较：a 大于 b 返回 true（同版本/降级不视为可用更新） */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

function releaseNotesText(info: UpdateInfo): string {
  const rn: unknown = info.releaseNotes
  if (Array.isArray(rn)) {
    return rn
      .map((n) => (typeof n === 'string' ? n : ((n as { note?: string }).note ?? '')))
      .join('\n\n')
  }
  return typeof rn === 'string' ? rn : ''
}

async function loadAutoUpdater(): Promise<AppUpdater> {
  const mod = (await import('electron-updater')) as {
    autoUpdater?: AppUpdater
    default?: { autoUpdater: AppUpdater }
  }
  const au = mod.autoUpdater ?? mod.default?.autoUpdater
  if (!au) throw new Error('electron-updater load failed')
  return au
}

/** 事件监听只挂一次；electron-updater 是事件源，这里只做状态归一与广播 */
function attachListeners(auto: AppUpdater): void {
  if (listenersAttached) return
  listenersAttached = true

  auto.on('update-available', (info) => {
    const ui = info as UpdateInfo
    // 同版本/降级不提示（electron-updater 检测到本地缓存有待装更新时也会发此事件）
    if (!isNewerVersion(ui.version, app.getVersion())) {
      patch({ phase: 'none', version: app.getVersion(), force: false })
      return
    }
    const notes = releaseNotesText(ui)
    const force = /强制更新|force-update/i.test(notes)
    // 强制更新仅锁定弹窗（不可关闭、必须完成更新），下载仍由用户点击触发
    patch({
      phase: 'available',
      version: ui.version,
      notes,
      force,
      percent: 0,
      error: '',
      releaseDate: typeof ui.releaseDate === 'string' ? ui.releaseDate : ''
    })
  })
  auto.on('update-not-available', () => {
    patch({ phase: 'none', version: app.getVersion(), force: false })
  })
  auto.on('download-progress', (p) => {
    patch({
      phase: 'downloading',
      percent: Math.min(100, Math.round(p.percent ?? 0)),
      bps: p.bytesPerSecond ?? 0
    })
  })
  auto.on('update-downloaded', (i) => {
    const ui = i as { version?: string }
    patch({ phase: 'downloaded', version: ui.version ?? state.version, percent: 100 })
  })
  auto.on('error', (err: Error) => {
    // idle 阶段的错误（如未发布 Release）静默保持 idle，不打扰用户
    if (state.phase === 'idle') return
    patch({ phase: 'error', error: err?.message ?? String(err) })
  })
}

async function ensureUpdater(): Promise<AppUpdater> {
  if (autoUpdater) return autoUpdater
  const au = await loadAutoUpdater()
  au.autoDownload = false // 有更新不自动下载，由用户在弹窗中决定
  au.autoInstallOnAppQuit = false // 已下载也不随退出自动安装：重启后仍提示，由用户确认后安装
  if (!app.isPackaged) au.forceDevUpdateConfig = true // dev 走项目根 dev-app-update.yml,否则 checkForUpdates 静默返回 null
  attachListeners(au)
  autoUpdater = au
  return au
}

/** 检查更新（事件驱动结果，本调用只触发流程）；看门狗兜底超时 */
export async function updateCheck(): Promise<void> {
  if (state.phase === 'downloading' || state.phase === 'downloaded') return
  const auto = await ensureUpdater()
  patch({ phase: 'checking', error: '' })
  const watchdog = setTimeout(() => {
    // electron-updater 的 requestTimeout 未生效或被代理拖住时的保险
    if (state.phase === 'checking') {
      patch({ phase: 'error', error: '检查更新超时，请检查网络（GitHub 访问）后重试' })
    }
  }, 25_000)
  try {
    await auto.checkForUpdates() // 结果经事件回流
    // null = 更新器未激活（dev 未强制配置）或官方判定无更新（此时 update-not-available
    // 事件已回流）;保险起见这里兜底为「已是最新」,避免停在检查中
    if (state.phase === 'checking') patch({ phase: 'none', version: app.getVersion(), force: false })
  } catch (err) {
    // 失败必须可见：显示具体原因（网络超时等），用户可重试。
    // 启动自动检查的失败同样是 error 态，但弹窗未打开即后台静默，不打扰
    const reason = err instanceof Error ? err.message : String(err)
    patch({ phase: 'error', error: reason })
    console.log('[updater] check failed:', reason)
  } finally {
    clearTimeout(watchdog)
  }
}

/** 开始下载（仅 available 阶段有效） */
export function updateDownload(): void {
  if (state.phase !== 'available' || !autoUpdater) return
  void autoUpdater.downloadUpdate()
}

/**
 * 启动时清理过期的待装安装包：electron-updater 安装完成后不会自动删除
 * 缓存目录里的安装包（约 167MB/版本）。待装版本不高于当前版本即视为过期。
 * 注意只清打包版的缓存目录（inkbox-updater）；dev 诊断缓存（-dev 后缀）手动管理。
 */
export function cleanStalePendingUpdate(): void {
  if (!app.isPackaged) return
  try {
    const dir = join(process.env.LOCALAPPDATA ?? '', 'inkbox-updater', 'pending')
    if (!existsSync(dir)) return
    const info = JSON.parse(readFileSync(join(dir, 'update-info.json'), 'utf-8')) as {
      version?: string
    }
    if (info.version && isNewerVersion(info.version, app.getVersion())) return // 有待装的新版本,保留
    rmSync(dir, { recursive: true, force: true })
    console.log('[updater] cleaned stale pending installer (version:', info.version ?? '?', ')')
  } catch (err) {
    console.log('[updater] clean pending skipped:', err instanceof Error ? err.message : err)
  }
}

/** 安装并重启：渲染层负责先把未保存内容/会话落盘，这里留恢复标记再交接给安装器 */
export function updateInstall(): void {
  if (state.phase !== 'downloaded') return
  markUpdateRestartPending(state.version)
  autoUpdater?.quitAndInstall(false, true) // 静默安装 + 完成后重启应用
}

export function getUpdateState(): UpdateStatePayload {
  return state
}

/** 启动挂载：主进程启动 10s 后静默检查一次（可用性经弹窗/图标呈现,不静默下载） */
export function initUpdateController(): void {
  if (!app.isPackaged && process.env.INKBOX_TEST_UPDATE !== '1') return
  cleanStalePendingUpdate()
  void (async () => {
    try {
      await ensureUpdater()
    } catch (err) {
      console.log('[updater] init failed:', err instanceof Error ? err.message : err)
      return
    }
    setTimeout(() => void updateCheck(), 10_000)
  })()
}
