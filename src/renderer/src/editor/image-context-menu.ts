import { reactive } from 'vue'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorView as CmView } from '@codemirror/view'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'
import { cmViews } from '@/editor/cm-registry'
import { pmViews } from '@/editor/pm-registry'
import { parseImageLine } from '@/editor/image-utils'
import { toLuciImgUrl } from '@/editor/image-persist'
import { maskExistingImage, unmaskExistingImage } from '@/editor/pm-wysiwyg-image'
import { writeClipboard } from '@/editor/code-copy'

/**
 * 图片右键菜单（渲染层自绘，双主题跟随应用 CSS 变量，见 ImageContextMenu.vue）：
 * - 捕获 contextmenu：img 元素（即显/预览/查看器）或源码光标处的图片语法
 *   （![alt](src)，CodeMirror 语法树定位）→ 弹自绘菜单。
 *   不走 webContents 'context-menu' 事件——main.ts 为压掉 Chromium 默认菜单
 *   全局 preventDefault 了 contextmenu，该事件不会触发；源码模式下主进程
 *   命中测试也只能拿到文本节点，识别不了图片语法，所以必须渲染层识别。
 * - 捕获 mousedown(button=2)：图片上压掉默认行为，即显(ProseMirror)右键
 *   不会再走「选中图片 → 弹浮动工具条」的左键副作用。
 * - 复制语义：本地图（luci-img://）复制图像数据（可粘贴到微信等任意处）；
 *   图床图（https）复制纯链接文本（不带 markdown 语法）。
 * - 「转 PicGo 上传」与粘贴链路同款：即显盖「上传中」遮罩、源码/双栏插占位
 *   文本，完成后编辑器原地替换（CM 事务/PM setNodeMarkup），不整档重载、
 *   不丢滚动位置；仅纯预览模式（无编辑器可就地改）回退 store 整档替换。
 */

/* ---------- 菜单状态（ImageContextMenu.vue 渲染） ---------- */

export type ImageMenuAction = 'copyImage' | 'copyLink' | 'openDir' | 'uploadPicgo'

export const imageMenu = reactive({ open: false, x: 0, y: 0, src: '' })

export function openImageMenu(src: string, x: number, y: number): void {
  imageMenu.open = true
  imageMenu.x = x
  imageMenu.y = y
  imageMenu.src = src
}

export function closeImageMenu(): void {
  imageMenu.open = false
}

/** 按 src 类型出菜单项：本地图 = 图像数据/打开目录/转 PicGo；占位 data: = 复制图像；图床图 = 纯链接 */
export function imageMenuItems(src: string): { action: ImageMenuAction; label: string }[] {
  if (src.startsWith('luci-img://')) {
    return [
      { action: 'copyImage', label: t('img.ctxCopyImage') },
      { action: 'openDir', label: t('img.ctxOpenDir') },
      { action: 'uploadPicgo', label: t('img.ctxUploadPicgo') }
    ]
  }
  if (src.startsWith('data:')) {
    return [{ action: 'copyImage', label: t('img.ctxCopyImage') }]
  }
  return [{ action: 'copyLink', label: t('img.copySrc') }]
}

export async function runImageMenuAction(action: ImageMenuAction, src: string): Promise<void> {
  closeImageMenu()
  if (action === 'copyImage') {
    // 图像数据走主进程剪贴板（nativeImage），可粘贴进微信等任意应用
    await window.api.image.copyImage(src)
  } else if (action === 'copyLink') {
    const ok = await writeClipboard(src)
    if (ok) useUiStore().showToast(t('img.srcCopied'))
  } else if (action === 'openDir') {
    window.api.image.openDir(src)
  } else {
    await uploadViaPicgo(src)
  }
}

/* ---------- 右键识别 ---------- */

/** 源码/双栏编辑器：右键处若是图片语法，解出图片 src（相对路径转 luci-img://） */
function resolveCmImageSrc(e: MouseEvent): string | null {
  const target = e.target
  if (!(target instanceof Node)) return null
  for (const view of cmViews()) {
    if (!view.dom.contains(target)) continue
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos == null) continue
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1)
    while (node && node.name !== 'Image') node = node.parent
    if (!node) continue
    const src = parseImageLine(view.state.doc.sliceString(node.from, node.to))?.src
    if (!src) continue
    if (/^(https?:|data:|luci-img:)/i.test(src)) return src
    return toLuciImgUrl(useDocumentsStore().active?.path ?? '', src)
  }
  return null
}

/** luci-img:// 绝对路径 → 文档内相对引用（与 image-persist.toLuciImgUrl 互逆） */
function luciToRelative(docPath: string, src: string): string | null {
  if (!src.startsWith('luci-img://')) return null
  const abs = decodeURIComponent(src.replace(/^luci-img:\/\//, '')).replace(/\\/g, '/')
  const sepIdx = Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\'))
  const dir = sepIdx > 0 ? docPath.slice(0, sepIdx).replace(/\\/g, '/') : null
  if (!dir) return abs
  return abs.startsWith(`${dir}/`) ? abs.slice(dir.length + 1) : abs
}

export function initImageContextMenu(): void {
  document.addEventListener(
    'contextmenu',
    (e) => {
      const el = e.target as HTMLElement | null
      if (el?.closest?.('.img-ctx-menu')) return // 菜单自身上的右键不重开
      const img = el?.closest?.('img') as HTMLImageElement | null
      const src = img?.src ?? resolveCmImageSrc(e)
      if (src) openImageMenu(src, e.clientX, e.clientY)
    },
    true
  )

  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 2) return
      if ((e.target as HTMLElement | null)?.closest?.('img')) e.preventDefault()
    },
    true
  )
}

/* ---------- 转 PicGo 上传：编辑器原地替换 ---------- */

async function uploadViaPicgo(src: string): Promise<void> {
  const ui = useUiStore()
  const docs = useDocumentsStore()
  const tab = docs.active
  if (!tab || tab.isHome || !src.startsWith('luci-img://')) return

  const pmView = pmViews()[0]
  const cmView = pmView ? undefined : cmViews()[0]
  const cmHandle = cmView ? beginCmUpload(cmView, tab.path ?? '', src) : null
  if (pmView) maskExistingImage(pmView, src)
  if (!pmView && !cmHandle) {
    // 纯预览模式没有可就地编辑的编辑器：退回整档替换（会丢滚动，属可接受的罕见路径）
    await legacyStoreUpload(src)
    return
  }

  const abs = decodeURIComponent(src.replace(/^luci-img:\/\//, ''))
  const name = abs.split(/[\\/]/).pop() ?? 'image'
  const ext = (abs.split('.').pop() ?? 'png').toLowerCase()

  try {
    const b64 = await window.api.fs.readBinary(abs)
    const res = await window.api.image.upload(
      name,
      `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`
    )
    if (!res.ok || !res.url) {
      ui.showToast(
        res.code === 'unreachable' ? t('editor.picgoUnreachable') : t('editor.imageUploadFailed')
      )
      await finishUpload(null)
      return
    }
    await finishUpload(res.url)
    ui.showToast(t('editor.imageUploaded', { name }))
  } catch (err) {
    console.error('[image-menu] picgo upload failed:', err)
    ui.showToast(t('editor.imageUploadFailed'))
    await finishUpload(null)
  }

  /** 成功换图床链接；失败(null)回滚——遮罩撤下/占位文本还原为原图引用 */
  async function finishUpload(url: string | null): Promise<void> {
    if (pmView) await unmaskExistingImage(pmView, src, url)
    else cmHandle?.finish(url)
  }
}

/* ---------- 源码/双栏：占位文本 + 原地还原（与粘贴占位同款格式） ---------- */

interface CmUploadHandle {
  finish: (url: string | null) => void
}

function beginCmUpload(view: CmView, docPath: string, src: string): CmUploadHandle | null {
  const rel = luciToRelative(docPath, src)
  if (!rel) return null
  const candidates = new Set([`](${rel})`, `](./${rel})`])
  // 找出所有引用该图的图片语法节点（同一图被引用多次时一并上传替换）
  const targets: { from: number; to: number; altRaw: string; text: string }[] = []
  const visit = (node: SyntaxNode): void => {
    if (node.name === 'Image') {
      const text = view.state.doc.sliceString(node.from, node.to)
      const raw = parseImageLine(text)?.src
      if (raw && candidates.has(`](${raw})`)) {
        const alt = /^!\[([\s\S]*)\]\(/.exec(text)?.[1] ?? ''
        targets.push({ from: node.from, to: node.to, altRaw: alt, text })
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
  }
  visit(syntaxTree(view.state).topNode)
  if (!targets.length) return null

  // 整图 markdown → 占位文本（一次事务一个撤销步）；完成后按占位串精确还原，
  // 上传期间的编辑不会破坏定位（占位符被删则该处静默放弃，与粘贴链路一致）
  const stamp = `${Date.now()}-${++cmUploadSeq}`
  const pending = targets.map((tg, i) => {
    const ph = `⏳ ${t('editor.imageUploading')} (inkbox-uploading-${stamp}-${i})`
    return { ph, altRaw: tg.altRaw, text: tg.text }
  })
  view.dispatch({
    changes: targets.map((tg, i) => ({
      from: tg.from,
      to: tg.to,
      insert: pending[i].ph
    }))
  })

  return {
    finish(url) {
      const full = view.state.doc.toString()
      const changes: { from: number; to: number; insert: string }[] = []
      for (const p of pending) {
        const i = full.indexOf(p.ph)
        if (i < 0) continue
        changes.push({
          from: i,
          to: i + p.ph.length,
          insert: url === null ? p.text : `![${p.altRaw}](${url})`
        })
      }
      if (changes.length) view.dispatch({ changes })
    }
  }
}

let cmUploadSeq = 0

/* ---------- 纯预览模式回退：store 整档替换（无编辑器可就地改） ---------- */

async function legacyStoreUpload(src: string): Promise<void> {
  const ui = useUiStore()
  const docs = useDocumentsStore()
  const tab = docs.active
  if (!tab) return
  const abs = decodeURIComponent(src.replace(/^luci-img:\/\//, ''))
  const name = abs.split(/[\\/]/).pop() ?? 'image'
  const ext = (abs.split('.').pop() ?? 'png').toLowerCase()
  try {
    const b64 = await window.api.fs.readBinary(abs)
    const res = await window.api.image.upload(
      name,
      `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`
    )
    if (!res.ok || !res.url) {
      ui.showToast(
        res.code === 'unreachable' ? t('editor.picgoUnreachable') : t('editor.imageUploadFailed')
      )
      return
    }
    const rel = luciToRelative(tab.path ?? '', src)
    const candidates = rel ? [`](${rel})`, `](./${rel})`] : [`](${abs})`]
    let content = tab.content
    let replaced = 0
    for (const cand of candidates) {
      const n = content.split(cand).length - 1
      if (n > 0) {
        content = content.split(cand).join(`](${res.url})`)
        replaced += n
      }
    }
    if (replaced === 0) {
      ui.showToast(t('editor.imageUploadFailed'))
      return
    }
    docs.updateContent(tab.id, content)
    // 即显/源码编辑器监听 extReloadSeq，收到后整档重载
    ui.notifyReload()
    ui.showToast(t('editor.imageUploaded', { name }))
  } catch (err) {
    console.error('[image-menu] picgo upload failed:', err)
    ui.showToast(t('editor.imageUploadFailed'))
  }
}
