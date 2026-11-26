/**
 * 剪贴板读写（渲染层统一入口）。
 *
 * 优先走主进程 Electron clipboard（preload → ipc）：渲染层的 navigator.clipboard
 * 在 Electron 里受用户激活/权限约束——右键菜单没有真实键盘激活，writeText 会被
 * 拒绝且静默失败，剪贴板保留上一次内容，粘贴出来就是无关的旧东西；readText 也
 * 可能给到过期值。主进程实现没有这些问题。
 *
 * 浏览器 dev 预览（无 preload）时退回 navigator.clipboard，再退回 execCommand。
 */

interface ClipboardBridge {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  writeRich(text: string, html?: string): Promise<void>
}

function bridge(): ClipboardBridge | null {
  const api = (window as unknown as { api?: { clipboard?: ClipboardBridge } }).api
  return api?.clipboard ?? null
}

/** 读剪贴板文本；失败返回 '' */
export async function readClipboardText(): Promise<string> {
  const b = bridge()
  if (b) {
    try {
      return await b.readText()
    } catch {
      /* 落到 navigator */
    }
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

/** 写纯文本；返回是否成功 */
export async function writeClipboardText(text: string): Promise<boolean> {
  const b = bridge()
  if (b) {
    try {
      await b.writeText(text)
      return true
    } catch {
      /* 落到 navigator */
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 回退：非安全上下文 / 无用户激活时走 execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** 写文本 + HTML（表格等富内容）；返回是否成功 */
export async function writeClipboardRich(text: string, html?: string): Promise<boolean> {
  const b = bridge()
  if (b) {
    try {
      await b.writeRich(text, html)
      return true
    } catch {
      /* 落到 navigator */
    }
  }
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })
      ])
      return true
    } catch {
      /* 退回纯文本 */
    }
  }
  return writeClipboardText(text)
}
