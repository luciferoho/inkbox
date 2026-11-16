import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { isOpenablePath, OPENABLE_EXTS } from '@shared/openable'
import type { AssocStatus } from '@shared/types'
import { m } from './i18n'

/**
 * 系统文件关联（HKCU 注册表，免管理员）：
 *  - 右键菜单「在 Inkbox 中打开」：SystemFileAssociations\<ext>\shell 注册动词，
 *    不论该扩展名当前默认应用是谁都会出现在资源管理器右键（Win11 在「显示更多选项」里）
 *  - 设为默认：注册 ProgId（Inkbox.Document）+ OpenWithProgids + RegisteredApplications
 *    能力声明（进 Windows 设置→默认应用），然后把各扩展名默认指向 Inkbox——
 *    Win10+ 不允许程序直接改 UserChoice，但删除 UserChoice 键后系统回落到
 *    HKCU\Software\Classes\<ext> 的默认 ProgId（「重置默认应用」走的就是这条路）
 *  - 右键/双击带起应用时命令行传文件路径，经 app:externalOpen / 启动队列交给渲染层打开
 *
 * 开发态同样可注册：命令指向 electron.exe + 应用目录（dev 验证不影响打包语义）。
 */

const PROG_ID = 'Inkbox.Document'
const VERB_KEY = 'Inkbox.Open'
const REG_BASE = 'HKCU\\Software\\Classes'

/** 注册到右键菜单与默认应用的扩展名（与渲染层可打开类型一致） */
const ASSOC_EXTS = OPENABLE_EXTS

function reg(args: string[]): string {
  return execFileSync('reg', args, { windowsHide: true, encoding: 'utf-8' })
}

function regAdd(key: string, value: string | null, data: string): void {
  // value = null 写默认值（/ve）
  reg(['add', key, ...(value === null ? ['/ve'] : ['/v', value]), '/t', 'REG_SZ', '/d', data, '/f'])
}

function regDelete(key: string): void {
  try {
    reg(['delete', key, '/f'])
  } catch {
    /* 键不存在即视为已删除 */
  }
}

function regQuery(key: string, value: string | null): string | null {
  try {
    const out = reg(['query', key, ...(value === null ? ['/ve'] : ['/v', value])])
    const line = out.split(/\r?\n/).find((l) => /^\s*(\(Default\)|\S+)\s+REG_\w+/.test(l))
    if (!line) return null
    return line.replace(/^\s*(\(Default\)|\S+)\s+REG_\w+\s*/, '').trim() || null
  } catch {
    return null
  }
}

/** 打开命令：打包版直接指向 Inkbox.exe；dev 指向 electron.exe + 应用目录 */
function openCommand(): string {
  const exe = process.execPath
  return app.isPackaged ? `"${exe}" "%1"` : `"${exe}" "${app.getAppPath()}" "%1"`
}

/** 关联变更后通知 Explorer 刷新缓存（SHChangeNotify(SHCNE_ASSOCCHANGED)） */
function notifyAssocChanged(): void {
  if (process.platform !== 'win32') return
  const ps =
    "Add-Type -Name S -Namespace InkboxShell -MemberDefinition " +
    "'[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(uint w,uint f,IntPtr p,IntPtr s);'; " +
    '[InkboxShell.S]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)'
  try {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => {
      /* 通知失败不影响注册结果，Explorer 最迟下次刷新时生效 */
    })
  } catch {
    /* 同上 */
  }
}

/** 注册「在 Inkbox 中打开」右键菜单动词（全部受支持扩展名） */
function registerContextMenu(): boolean {
  try {
    for (const ext of ASSOC_EXTS) {
      const key = `${REG_BASE}\\SystemFileAssociations\\${ext}\\shell\\${VERB_KEY}`
      regAdd(key, null, m('ctxOpenInkbox'))
      regAdd(key, 'Icon', `"${process.execPath}",0`)
      regAdd(`${key}\\command`, null, openCommand())
    }
    notifyAssocChanged()
    return true
  } catch {
    return false
  }
}

function unregisterContextMenu(): boolean {
  try {
    for (const ext of ASSOC_EXTS) {
      regDelete(`${REG_BASE}\\SystemFileAssociations\\${ext}\\shell\\${VERB_KEY}`)
    }
    notifyAssocChanged()
    return true
  } catch {
    return false
  }
}

/** 注册 ProgId 与「打开方式」/系统默认应用声明（设为默认的前置） */
function registerFileTypes(): boolean {
  try {
    regAdd(`${REG_BASE}\\${PROG_ID}`, null, m('assocDocType'))
    regAdd(`${REG_BASE}\\${PROG_ID}\\DefaultIcon`, null, `"${process.execPath}",0`)
    regAdd(`${REG_BASE}\\${PROG_ID}\\shell\\open\\command`, null, openCommand())
    for (const ext of ASSOC_EXTS) {
      // 进「打开方式」菜单与「按文件类型选择默认应用」列表
      regAdd(`${REG_BASE}\\${ext}\\OpenWithProgids`, PROG_ID, '')
    }
    // Windows 设置 → 默认应用 → 按应用设置默认 的能力声明
    const caps = 'HKCU\\Software\\Inkbox\\Capabilities'
    regAdd(caps, 'ApplicationName', 'Inkbox')
    regAdd(caps, 'ApplicationDescription', m('assocAppDesc'))
    for (const ext of ASSOC_EXTS) {
      regAdd(`${caps}\\FileAssociations`, ext, PROG_ID)
    }
    regAdd('HKCU\\SOFTWARE\\RegisteredApplications', 'Inkbox', 'Software\\Inkbox\\Capabilities')
    return true
  } catch {
    return false
  }
}

/** 设为默认：各扩展名的默认 ProgId 指向 Inkbox。
 *  UserChoice 是用户在系统设置里的显式选择（带哈希防篡改），仅当它不是 Inkbox 时
 *  删除之——之后系统回落到 HKCU\Software\Classes\<ext> 默认值，即本次写入的 ProgId */
function setDefault(): boolean {
  if (!registerFileTypes()) return false
  try {
    for (const ext of ASSOC_EXTS) {
      const ucKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`
      const current = regQuery(ucKey, 'ProgId')
      if (current && current !== PROG_ID) regDelete(ucKey)
      regAdd(`${REG_BASE}\\${ext}`, null, PROG_ID)
    }
    notifyAssocChanged()
    return true
  } catch {
    return false
  }
}

/** 注册表实况：右键菜单是否已注册、各扩展名当前默认是否 Inkbox */
function assocStatus(): AssocStatus {
  const defaults: Record<string, boolean> = {}
  let contextMenu = true
  for (const ext of ASSOC_EXTS) {
    defaults[ext] = isDefaultFor(ext)
    if (!regQuery(`${REG_BASE}\\SystemFileAssociations\\${ext}\\shell\\${VERB_KEY}`, null)) {
      contextMenu = false
    }
  }
  return { contextMenu, defaults }
}

function isDefaultFor(ext: string): boolean {
  // UserChoice 存在时它说了算；否则看 HKCU 扩展名默认 ProgId
  const uc = regQuery(
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`,
    'ProgId'
  )
  if (uc) return uc === PROG_ID
  return (regQuery(`${REG_BASE}\\${ext}`, null) ?? '') === PROG_ID
}

/* ---------- 命令行文件载荷（右键打开 / 双击关联文件） ---------- */

/** 本次运行待打开的文件队列：渲染层启动后经 app:takeLaunchFiles 一次性取走；
 *  没有编辑窗口可投递时（异常兜底）也暂存于此 */
let pendingFiles: string[] = []

export function pushLaunchFiles(files: string[]): void {
  if (!files.length) return
  const seen = new Set(pendingFiles.map((f) => f.toLowerCase()))
  for (const f of files) {
    const key = f.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      pendingFiles.push(f)
    }
  }
}

export function takeLaunchFiles(): string[] {
  const files = pendingFiles
  pendingFiles = []
  return files
}

/** 从启动参数提取文档文件路径：跳过开关与目录（dev 下 argv 含应用目录/点） */
export function filesFromArgv(argv: string[]): string[] {
  const out: string[] = []
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue
    let p: string
    try {
      p = resolve(a)
    } catch {
      continue
    }
    if (!existsSync(p) || !statSync(p).isFile() || !isOpenablePath(p)) continue
    if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p)
  }
  return out
}

/** 二次启动带起的文件投递给现有编辑窗口（无窗口则暂存等启动后取走） */
export function deliverFiles(win: BrowserWindow | null, files: string[]): void {
  if (!files.length) return
  if (win && !win.isDestroyed()) win.webContents.send('app:externalOpen', files)
  else pushLaunchFiles(files)
}

export function registerShellAssocIpc(): void {
  ipcMain.handle('assoc:status', (): AssocStatus => assocStatus())
  ipcMain.handle('assoc:setContextMenu', (_e, on: unknown): { ok: boolean } => ({
    ok: process.platform === 'win32' && (on ? registerContextMenu() : unregisterContextMenu())
  }))
  ipcMain.handle('assoc:setDefault', (): { ok: boolean } => ({
    ok: process.platform === 'win32' && setDefault()
  }))
  ipcMain.handle('assoc:openDefaultSettings', async (): Promise<void> => {
    await shell.openExternal('ms-settings:defaultapps').catch(() => undefined)
  })
  ipcMain.handle('app:takeLaunchFiles', (): string[] => takeLaunchFiles())
}
