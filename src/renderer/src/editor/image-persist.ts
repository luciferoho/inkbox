import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

/**
 * 图片粘贴/拖拽/插入的共享上传链路：
 * - 开启图床（PicGo server）先传图床，成功返回远端链接
 * - 未开启/失败回退文档旁 .assets 落盘
 * 供源码编辑器（CodeMirror）与即显编辑器（Milkdown）共用。
 */

export function fileExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  }
  return map[mime] ?? 'png'
}

/** 文件名 → MIME（工具条插入本地图片用；未知扩展按 png） */
export function mimeFromName(name: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml'
  }
  return map[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png'
}

/** 文档旁的 .assets 目录信息：`dir` 为文档所在目录，`assetsDir` 为资源目录名 */
export function assetsDirFor(docPath: string): { dir: string; assetsDir: string } {
  const sepIdx = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  const dir = sepIdx > 0 ? docPath.slice(0, sepIdx) : '.'
  const base = (docPath.split(/[\\/]/).pop() ?? 'doc').replace(/\.[^.]+$/, '')
  return { dir, assetsDir: `${base}.assets` }
}

/** 相对图片路径 → luci-img:// 绝对协议（即显数据层约定,渲染才找得到本地文件） */
export function toLuciImgUrl(docPath: string, relative: string): string {
  const sepIdx = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  const dir = sepIdx > 0 ? docPath.slice(0, sepIdx).replace(/\\/g, '/') : null
  if (!dir) return relative
  const abs = `${dir}/${relative.replace(/^\.\//, '')}`
  return (
    'luci-img://' +
    encodeURIComponent(abs).replace(/%2F/gi, '/').replace(/\(/g, '%28').replace(/\)/g, '%29')
  )
}

/** Uint8Array → base64（分段避免 String.fromCharCode 展开上限） */
export function toBase64(buf: Uint8Array): string {
  let bin = ''
  for (let k = 0; k < buf.length; k += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(k, k + 0x8000))
  }
  return btoa(bin)
}

/** 粘贴/拖拽/插入的图片文件抽象 */
export interface FileEntry {
  name: string
  type: string
}

/**
 * 单张图片落点：开启图床上传先传 PicGo server（成功返回远端链接）；
 * 未开启/失败回退本地 .assets 落盘。null = 两条路都失败（调用方跳过该图）。
 * 失败/成功均以 toast 呈现（imageUploaded/imageUploadFailed/picgoUnreachable/imageSaveFailed）。
 * 本函数不 reject：上传链路的任何异常都归一化为回退本地,调用方的占位符/遮罩总能收尾。
 */
export async function persistImage(
  file: FileEntry,
  buf: Uint8Array,
  docPath: string
): Promise<string | null> {
  const ui = useUiStore()
  const { dir, assetsDir } = assetsDirFor(docPath)
  const name = file.name
  if (ui.upload.enabled) {
    let res: { ok: boolean; url?: string; error?: string; code?: 'unreachable' }
    try {
      res = await window.api.image.upload(name, `data:${file.type};base64,${toBase64(buf)}`)
    } catch (err) {
      // IPC reject 兜底（正常失败已在主进程归一化为 {ok:false}）
      console.warn('[editor] image upload ipc rejected:', err)
      res = { ok: false, error: String(err) }
    }
    // 双保险：主进程未升级时拿不到 code,从错误串里识别连接拒绝/超时
    if (!res.ok && res.code !== 'unreachable' && res.error) {
      const e = res.error
      if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(e)) res = { ...res, code: 'unreachable' }
    }
    if (res.ok && res.url) {
      ui.showToast(t('editor.imageUploaded', { name }))
      return `![${name}|center](${res.url})`
    }
    console.warn('[editor] image upload failed, fallback to .assets:', res.error)
    // 服务端连不上（典型：设置了图床但本地 PicGo 没启动）→ 点名提示;其余失败走通用文案
    ui.showToast(
      res.code === 'unreachable' ? t('editor.picgoUnreachable') : t('editor.imageUploadFailed')
    )
  }
  try {
    await window.api.fs.writeFileBinary(`${dir}/${assetsDir}/${name}`, toBase64(buf))
    return `![${name}|center](./${assetsDir}/${name})`
  } catch (err) {
    console.error('[editor] image save failed:', err)
    ui.showToast(t('editor.imageSaveFailed', { name }))
    return null
  }
}
