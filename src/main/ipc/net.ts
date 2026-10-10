import { ipcMain, net, app } from 'electron'
import { mkdirSync, existsSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getConfig } from './config'

/**
 * 图床上传（6.8）：PicGo server 协议——
 * POST {list: [item]} 到用户配置的服务端（PicGo 应用需开启 Server），
 * 响应 {success: true, result: [url, ...]}。失败不抛 IPC 异常，
 * 由渲染层按 {ok:false} 回退本地 .assets 落盘。
 *
 * item 形态兼容两种 server 实现（均为本机 127.0.0.1,路径可直接读取）：
 * - 路径型（部分定制 server,如 picgo-cloud 配置）：把 list 字符串当磁盘路径读取,
 *   base64 dataURL 会被当路径读取而失败 → 先落临时文件再传路径（主策略）
 * - base64 型（标准 PicGo server）：list 收 base64 dataURL 字符串 → 失败时回退
 */

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif'
}

/** 上传结果：失败时 code='unreachable' 表示服务端连不上（未启动/端口不对/超时），供渲染层给出针对性提示 */
export interface UploadResult {
  ok: boolean
  url?: string
  error?: string
  code?: 'unreachable'
}

/** 网络层异常 → 归一化错误信息（fetch 抛错不拦会被 IPC 序列化成 reject,渲染层拿不到结构化结果） */
function toNetError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(msg)) return 'connection refused (server not running?)'
  if ((err as Error)?.name === 'TimeoutError' || /TIMEOUT|ETIMEDOUT/i.test(msg)) return 'timeout'
  return msg
}

/** 向 server POST 一种形态的 list,返回解析结果 */
async function postToServer(server: string, list: unknown[]): Promise<UploadResult> {
  let res: Response
  try {
    res = await net.fetch(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list }),
      signal: AbortSignal.timeout(30_000)
    })
  } catch (err) {
    return { ok: false, error: toNetError(err), code: 'unreachable' }
  }
  const data = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: unknown }
    | null
  const url = Array.isArray(data?.result) ? (data?.result as unknown[])[0] : null
  if (res.ok && data?.success === true && typeof url === 'string' && url) {
    return { ok: true, url }
  }
  const msg = (data as { message?: string } | null)?.message
  return { ok: false, error: `server response: ${res.status}${msg ? ` (${msg})` : ''}` }
}

export function registerNetIpc(): void {
  ipcMain.handle(
    'image:upload',
    async (_e, fileName: string, dataUrl: string): Promise<UploadResult> => {
      const { server } = getConfig().upload
      if (!/^https?:\/\//i.test(server)) return { ok: false, error: 'invalid server url' }
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return { ok: false, error: 'invalid payload' }
      }
      const meta = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(dataUrl)
      if (!meta) return { ok: false, error: 'invalid payload' }
      const ext = MIME_EXT[meta[1].toLowerCase()] ?? '.png'

      // 主策略：落临时文件,以路径上传（本地 server 读取磁盘文件,兼容定制实现）。
      // 临时文件放在独立子目录并保持原始文件名（远端文件名即此名,不重复加后缀）；
      // 上传后临时文件即删,同名再粘贴按序号避让
      const safeName = (fileName || 'image').replace(/[\\/:*?"<>|]/g, '_').replace(/\.[a-z0-9]+$/i, '')
      const tmpDir = join(app.getPath('temp'), 'inkbox-upload')
      mkdirSync(tmpDir, { recursive: true })
      let tmpPath = join(tmpDir, `${safeName}${ext}`)
      let n = 2
      while (existsSync(tmpPath)) tmpPath = join(tmpDir, `${safeName}-${n++}${ext}`)
      let tmpWritten = false
      try {
        await writeFile(tmpPath, Buffer.from(meta[2], 'base64'))
        tmpWritten = true
      } catch (err) {
        return { ok: false, error: `temp file: ${String((err as Error)?.message ?? err)}` }
      }

      try {
        // 路径形态
        const byPath = await postToServer(server, [tmpPath])
        if (byPath.ok) return byPath
        // 回退：base64 形态（标准 PicGo server）
        const byBase64 = await postToServer(server, [dataUrl])
        if (byBase64.ok) return byBase64
        // 两种都失败:优先返回路径形态的错误（主策略,信息更贴近真实原因）
        return byPath.error ? byPath : byBase64
      } finally {
        if (tmpWritten) void unlink(tmpPath).catch(() => {})
      }
    }
  )
}

