/**
 * 生成应用图标：墨匣 spark（琥珀四芒星）+ 墨脊深色圆角底。
 * 产物：build/icon.ico（多尺寸）/ build/icon.png（512，Linux/mac 用）。
 * 用法：npm run icons
 */
import { createCanvas, Path2D } from '@napi-rs/canvas'
import pngToIco from 'png-to-ico'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPARK_PATH =
  'M12 2c.6 4.8 2.4 7 7.2 7.6-4.8.9-6.6 3.1-7.2 8-0.6-4.9-2.4-7.1-7.2-8C9.6 9 11.4 6.8 12 2z'

async function renderPng(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const r = size * 0.19
  // 墨脊深色圆角底
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(size, 0, size, size, r)
  ctx.arcTo(size, size, 0, size, r)
  ctx.arcTo(0, size, 0, 0, r)
  ctx.arcTo(0, 0, size, 0, r)
  ctx.closePath()
  ctx.fillStyle = '#26201a'
  ctx.fill()
  // 琥珀 spark（24 视图坐标缩放居中）
  const s = size * 0.56
  const off = (size - s) / 2
  ctx.save()
  ctx.translate(off, off)
  ctx.scale(s / 24, s / 24)
  ctx.fillStyle = '#e6a054'
  ctx.fill(new Path2D(SPARK_PATH))
  ctx.restore()
  return canvas.encode('png')
}

mkdirSync(join(ROOT, 'build'), { recursive: true })

const png512 = await renderPng(512)
writeFileSync(join(ROOT, 'build', 'icon.png'), png512)

const sizes = [256, 128, 64, 48, 32, 16]
const ico = await pngToIco(await Promise.all(sizes.map((n) => renderPng(n))))
writeFileSync(join(ROOT, 'build', 'icon.ico'), ico)
console.log('icon.ico + icon.png generated in build/')
