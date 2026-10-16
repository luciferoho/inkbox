/**
 * 图片固有尺寸缓存（预览/即显两窗格共享）：
 * 图片加载前没有高度，布局在加载窗口期不断被撑高——预览的块映射、切签锚点
 * 落位、即显的滚动恢复全部失准。把每张图的固有尺寸按解析后的 src 记下来，
 * 重渲染时立刻写回 aspect-ratio/width 占位，第二次及以后的渲染（切签回来、
 * 输入触发的重排）布局从第一帧起就与加载完成后一致。
 */
const imgSizeCache = new Map<string, [number, number]>()

export function rememberImgSize(src: string, w: number, h: number): void {
  if (imgSizeCache.size >= 2000) {
    const oldest = imgSizeCache.keys().next().value
    if (oldest !== undefined) imgSizeCache.delete(oldest)
  }
  imgSizeCache.set(src, [w, h])
}

/** 给有尺寸记录的图补占位尺寸：已带内联宽度的修饰图只补 aspect-ratio；
 *  未修饰图补 width+natural（上限由 max-width:100% 兜住） */
export function applyCachedImageSizes(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const hit = imgSizeCache.get(img.src)
    if (!hit || hit[0] < 1 || hit[1] < 1) return
    if (!img.style.aspectRatio) img.style.aspectRatio = `${hit[0]} / ${hit[1]}`
    if (!img.style.width) img.style.width = `${hit[0]}px`
  })
}
