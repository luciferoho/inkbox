import { parseOutline, renderWithDir } from './markdown'

/**
 * ePub 导出（3.5）：Markdown → EPUB 2/3 兼容包（.epub = ZIP）。
 * 零依赖：自实现 store（不压缩）ZIP 写器——ePub 规范允许 store 条目，
 * mimetype 必须为首个条目且不压缩，本写器天然满足。
 *
 * 章节：按一级标题切分（无 H1 则整档单章）；章节正文经预览管线渲染
 * （docDir 解析相对图片为 luci-img 协议——阅读器不认识该协议，本地相对
 * 图片在 ePub 内不可见是已知限制，远程图/图床图正常）。
 */

interface ZipEntry {
  name: string
  data: Uint8Array
}

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** store ZIP（不压缩）：mimetype 首条目是 ePub 规范硬性要求 */
function zipStore(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  for (const e of entries) {
    const nameBytes = encoder.encode(e.name)
    const crc = crc32(e.data)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // flags: UTF-8 文件名
    lv.setUint16(8, 0, true) // method: store
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, e.data.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    chunks.push(local, e.data)

    const cdir = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cdir.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, dosTime, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cdir.set(nameBytes, 46)
    central.push(cdir)

    offset += local.length + e.data.length
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const total = offset + centralSize + 22
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of [...chunks, ...central, eocd]) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

function xhtmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const EPUB_CSS = `body { font-family: serif; line-height: 1.7; margin: 1em; color: #222; }
h1, h2, h3 { line-height: 1.35; }
pre { background: #f4f2ee; padding: 0.8em; overflow-x: auto; font-size: 0.85em; white-space: pre-wrap; }
code { font-family: monospace; }
blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #555; }
img { max-width: 100%; }
table { border-collapse: collapse; } td, th { border: 1px solid #bbb; padding: 4px 8px; }`

function chapterXhtml(title: string, bodyHtml: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">',
    '<head><meta charset="utf-8"/>',
    `<link rel="stylesheet" type="text/css" href="style.css"/>`,
    `<title>${xhtmlEscape(title)}</title></head>`,
    '<body>',
    bodyHtml,
    '</body></html>'
  ].join('\n')
}

/** 按一级标题切片：返回 [{title, md}]；无 H1 → 整档单章 */
function splitChapters(md: string): { title: string; md: string }[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const h1s = parseOutline(md).filter((h) => h.level === 1)
  if (h1s.length === 0) return [{ title: '全文', md }]
  const chapters: { title: string; md: string }[] = []
  for (let i = 0; i < h1s.length; i++) {
    const from = h1s[i]!.line - 1
    const to = i + 1 < h1s.length ? h1s[i + 1]!.line - 1 : lines.length
    chapters.push({ title: h1s[i]!.text, md: lines.slice(from, to).join('\n') })
  }
  return chapters
}

const encoder = new TextEncoder()

/** 构建 ePub 包 → base64（走 writeFileBinary 落盘） */
export async function buildEpubBase64(title: string, md: string, docDir: string | null): Promise<string> {
  const chapters = splitChapters(md)
  const entries: ZipEntry[] = []
  entries.push({ name: 'mimetype', data: encoder.encode('application/epub+zip') })
  entries.push({
    name: 'META-INF/container.xml',
    data: encoder.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
        '</rootfiles></container>'
    )
  })
  entries.push({ name: 'OEBPS/style.css', data: encoder.encode(EPUB_CSS) })

  const bookId = `urn:uuid:${crypto.randomUUID()}`
  const manifest: string[] = ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', '<item id="css" href="style.css" media-type="text/css"/>']
  const spine: string[] = []
  chapters.forEach((ch, i) => {
    const id = `ch${i + 1}`
    const href = `chapter-${i + 1}.xhtml`
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="${id}"/>`)
    const html = renderWithDir(ch.md, docDir)
    entries.push({ name: `OEBPS/${href}`, data: encoder.encode(chapterXhtml(ch.title, html)) })
  })

  const opf = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">',
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:identifier id="bookid">${bookId}</dc:identifier>`,
    `<dc:title>${xhtmlEscape(title)}</dc:title>`,
    '<dc:language>zh-CN</dc:language>',
    '<dc:creator>Inkbox</dc:creator>',
    '<meta property="dcterms:modified">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</meta>',
    '</metadata>',
    '<manifest>',
    ...manifest,
    '</manifest>',
    `<spine toc="ncx">`,
    ...spine,
    '</spine>',
    '</package>'
  ].join('\n')
  entries.push({ name: 'OEBPS/content.opf', data: encoder.encode(opf) })

  const navPoints = chapters
    .map(
      (ch, i) =>
        `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${xhtmlEscape(ch.title)}</text></navLabel><content src="chapter-${i + 1}.xhtml"/></navPoint>`
    )
    .join('\n')
  const ncx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    '<head><meta name="dtb:uid" content="' + bookId + '"/></head>',
    '<docTitle><text>' + xhtmlEscape(title) + '</text></docTitle>',
    '<navMap>',
    navPoints,
    '</navMap>',
    '</ncx>'
  ].join('\n')
  entries.push({ name: 'OEBPS/toc.ncx', data: encoder.encode(ncx) })

  const zip = zipStore(entries)
  // 分块 btoa：大包一次性 btoa 会超调用栈/参数上限
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < zip.length; i += CHUNK) {
    bin += String.fromCharCode(...zip.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}
