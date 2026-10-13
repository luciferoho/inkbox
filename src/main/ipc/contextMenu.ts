import { clipboard, nativeImage, net, ipcMain, shell, ClipboardItem } from 'electron'

/** luci-img://（本地图）/ data: / https 图 → 剪贴板图像数据，可粘贴进微信等任意应用 */
async function copyImageToClipboard(src: string): Promise<boolean> {
  try {
    let image: Electron.NativeImage | null = null
    if (src.startsWith('luci-img://')) {
      image = nativeImage.createFromPath(decodeURIComponent(src.replace(/^luci-img:\/\//, '')))
    } else if (src.startsWith('data:')) {
      image = nativeImage.createFromDataURL(src)
    } else if (/^https?:/.test(src)) {
      const resp = await net.fetch(src)
      image = nativeImage.createFromBuffer(Buffer.from(await resp.arrayBuffer()))
    }
    if (!image || image.isEmpty()) return false
    // Electron 44 W3C 剪贴板：write 只收 ClipboardItem[]（旧 writeImage 已移除）；
    // ClipboardItem 构造器由 electron 模块直接导出（主进程无 DOM global）
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())]) })])
    return true
  } catch (err) {
    console.error('[ctx-menu] copy image failed:', err)
    return false
  }
}

/**
 * 图片右键菜单的主进程侧：只提供两个动作，菜单本体由渲染层自绘
 * （ImageContextMenu.vue，跟随应用明暗主题；Windows 原生菜单做不了双主题）。
 * - image:copy-image：复制图像数据（渲染层无法拿 nativeImage）
 * - image:open-dir：资源管理器中打开本地图片所在目录并选中
 */
export function registerImageContextMenu(): void {
  ipcMain.handle('image:copy-image', (_e, src: unknown): Promise<boolean> =>
    typeof src === 'string' && src ? copyImageToClipboard(src) : Promise.resolve(false)
  )
  ipcMain.on('image:open-dir', (_e, src: unknown) => {
    if (typeof src !== 'string' || !src.startsWith('luci-img://')) return
    const abs = decodeURIComponent(src.replace(/^luci-img:\/\//, ''))
    // 只放行绝对路径，防渲染层异常数据带出相对路径歧义
    if (!/^[a-zA-Z]:[\\/]/.test(abs) && !abs.startsWith('/')) return
    shell.showItemInFolder(abs)
  })
}
