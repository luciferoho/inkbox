import { ipcMain, net } from 'electron'
import { getConfig } from './config'

/**
 * 图床上传（6.8）：PicGo server 协议——
 * POST {list: [dataURL]} 到用户配置的服务端（PicGo 应用需开启 Server），
 * 响应 {success: true, result: [url, ...]}。失败不抛 IPC 异常，
 * 由渲染层按 {ok:false} 回退本地 .assets 落盘。
 */
export function registerNetIpc(): void {
  ipcMain.handle(
    'image:upload',
    async (_e, fileName: string, dataUrl: string): Promise<{ ok: boolean; url?: string; error?: string }> => {
      const { server } = getConfig().upload
      if (!/^https?:\/\//i.test(server)) return { ok: false, error: 'invalid server url' }
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return { ok: false, error: 'invalid payload' }
      }
      try {
        const res = await net.fetch(server, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list: [dataUrl] }),
          signal: AbortSignal.timeout(30_000)
        })
        const data = (await res.json().catch(() => null)) as
          | { success?: boolean; result?: unknown }
          | null
        const url = Array.isArray(data?.result) ? (data?.result as unknown[])[0] : null
        if (res.ok && data?.success === true && typeof url === 'string' && url) {
          return { ok: true, url }
        }
        return { ok: false, error: `server response: ${res.status}` }
      } catch (err) {
        console.error('[image] upload failed:', fileName, err)
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    }
  )
}
