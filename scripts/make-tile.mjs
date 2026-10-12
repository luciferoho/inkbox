/**
 * 生成开始菜单磁贴图：build/tile-150.png / build/tile-70.png。
 * 背景 = 深色主题磁贴灰（#3A3A3A，与系统磁贴底一致），
 * 居中 = 墨匣圆角图标（占比 ICON_RATIO，与其他应用磁贴观感一致）。
 * 用法：node scripts/make-tile.mjs
 * 分发：electron-builder.yml extraFiles（配合 build/Inkbox.VisualElementsManifest.xml）
 */
import { createCanvas, Path2D } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPARK = 'M12 2c.6 4.8 2.4 7 7.2 7.6-4.8.9-6.6 3.1-7.2 8-0.6-4.9-2.4-7.1-7.2-8C9.6 9 11.4 6.8 12 2z'

/** 深色主题磁贴底色（与系统磁贴灰一致） */
const TILE_BG = '#3A3A3A'
/** 图标墨脊底色 */
const ICON_BG = '#26201A'
/** 琥珀星色 */
const SPARK_COLOR = '#E6A054'
/** 图标占磁贴边长比例：与其他应用磁贴观感对齐 */
const ICON_RATIO = 0.4

function tile(size) {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')

  ctx.fillStyle = TILE_BG
  ctx.fillRect(0, 0, size, size)

  const icon = size * ICON_RATIO
  const off = (size - icon) / 2
  const r = icon * 0.19
  ctx.beginPath()
  ctx.moveTo(off + r, off)
  ctx.arcTo(off + icon, off, off + icon, off + icon, r)
  ctx.arcTo(off + icon, off + icon, off, off + icon, r)
  ctx.arcTo(off, off + icon, off, off, r)
  ctx.arcTo(off, off, off + icon, off, r)
  ctx.closePath()
  ctx.fillStyle = ICON_BG
  ctx.fill()

  const s = icon * 0.56
  const so = (icon - s) / 2
  ctx.save()
  ctx.translate(off + so, off + so)
  ctx.scale(s / 24, s / 24)
  ctx.fillStyle = SPARK_COLOR
  ctx.fill(new Path2D(SPARK))
  ctx.restore()

  return c.toBuffer('image/png')
}

for (const size of [150, 70]) {
  writeFileSync(join(ROOT, 'build', `tile-${size}.png`), tile(size))
  console.log(`build/tile-${size}.png written`)
}
