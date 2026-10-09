import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
import { persistImage, fileExt, toLuciImgUrl } from '@/editor/image-persist'
import { t } from '@/i18n'

/**
 * 即显模式图片粘贴/拖拽：与源码编辑器共用上传链路（editor/image-persist.ts）。
 * - 粘贴/拖入图片后，base64 占位图立即上屏，并在图片上覆盖「上传中」遮罩
 * - 上传完成后：先预加载网络图片（decode 入缓存）→ 原地换 src → 移除遮罩，
 *   替换全程不出现空白
 * - 回退本地的相对路径转 luci-img:// 绝对协议（即显数据层约定）
 */

interface UploadMask {
  uid: string
  view: EditorView
  el: HTMLDivElement
  onScroll: () => void
  ro: ResizeObserver
  observed: HTMLElement | null
}

const masks = new Map<string, UploadMask>()

export function createWysiwygImagePlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) =>
          f.type.startsWith('image/')
        )
        if (files.length === 0) return false
        void handleImages(files, view)
        return true
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) =>
          f.type.startsWith('image/')
        )
        if (files.length === 0) return false
        void handleImages(files, view, event)
        return true
      }
    },
    // 文档变化（打字/换行）时重定位所有遮罩,保持盖在图片上
    view: (editorView) => ({
      update: (v) => relocateForView(v),
      destroy: () => {
        for (const [uid, m] of [...masks]) {
          if (m.view === editorView) removeMask(uid)
        }
      }
    })
  })
}

let seq = 0

async function handleImages(files: File[], view: EditorView, drop?: DragEvent): Promise<void> {
  const ui = useUiStore()
  const docs = useDocumentsStore()
  const docPath = docs.active?.path
  if (!docPath) {
    ui.showToast(t('editor.saveFirstForImage'))
    return
  }
  const stamp = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(
    stamp.getHours()
  )}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`

  for (const [i, file] of files.entries()) {
    const name = `IMG_${ts}${files.length > 1 ? `_${i + 1}` : ''}.${fileExt(file.type)}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const uid = `${Date.now()}-${++seq}`
    const fullSrc = `data:${file.type};base64,${toBase64Safe(buf)}#${uid}`
    insertPlaceholder(view, fullSrc, `${name}|center`, uid, drop)
    createMask(view, uid)

    const link = await persistImage({ name, type: file.type }, buf, docPath)
    try {
      if (link) {
        const raw = /\]\(([^)\s]+)\)/.exec(link)?.[1]
        if (raw) {
          const finalSrc = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)
            ? raw
            : toLuciImgUrl(docPath, raw)
          // 先把目标图加载进缓存再换 src：替换瞬间即取即显,不留空白
          await preloadImage(finalSrc)
          swapSrc(view, uid, finalSrc)
        } else removePlaceholder(view, uid)
      } else removePlaceholder(view, uid)
    } finally {
      removeMask(uid)
    }
  }
}

/* ---------- 占位图与替换 ---------- */

function srcEndsWithUid(src: string, uid: string): boolean {
  return src.endsWith(`#${uid}`)
}

function insertPlaceholder(view: EditorView, src: string, alt: string, uid: string, drop?: DragEvent): void {
  const schema = view.state.schema
  const node = schema.nodes.image.create({ src, alt })
  let pos: number | undefined
  if (drop) {
    try {
      pos = view.posAtCoords({ left: drop.clientX, top: drop.clientY })?.pos ?? undefined
    } catch {
      pos = undefined
    }
  }
  const tr = view.state.tr
  try {
    if (pos == null) tr.replaceSelectionWith(node)
    else tr.insert(pos, node)
  } catch {
    tr.replaceSelectionWith(node)
  }
  view.dispatch(tr)
}

function findImgPos(view: EditorView, uid: string): number | null {
  let found: number | null = null
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && srcEndsWithUid(n.attrs.src as string, uid)) {
      found = pos
      return false
    }
    return true
  })
  return found
}

function swapSrc(view: EditorView, uid: string, final: string): void {
  const found: { pos: number; node: PMNode }[] = []
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && srcEndsWithUid(n.attrs.src as string, uid)) {
      found.push({ pos, node: n })
    }
  })
  if (!found.length) return
  const tr = view.state.tr
  for (const { pos, node } of found) {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: final })
  }
  view.dispatch(tr)
}

function removePlaceholder(view: EditorView, uid: string): void {
  const found: { pos: number; node: PMNode }[] = []
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && srcEndsWithUid(n.attrs.src as string, uid)) {
      found.push({ pos, node: n })
    }
  })
  if (!found.length) return
  const tr = view.state.tr
  for (const { pos, node } of found) tr.delete(pos, pos + node.nodeSize)
  view.dispatch(tr)
}

/* ---------- 上传中遮罩（覆盖在占位图上,随文档/滚动实时跟随） ---------- */

function hostOf(view: EditorView): HTMLElement | null {
  return view.dom.closest('.wysiwyg-host')
}

function createMask(view: EditorView, uid: string): void {
  const host = hostOf(view)
  if (!host) return
  const el = document.createElement('div')
  el.className = 'img-upload-mask'
  const spinner = document.createElement('span')
  spinner.className = 'mask-spinner'
  const label = document.createElement('span')
  label.textContent = t('editor.imageUploading')
  el.append(spinner, label)
  host.appendChild(el)

  const onScroll = (): void => positionMask(view, uid)
  host.addEventListener('scroll', onScroll, { passive: true })
  // 占位图加载/换行导致尺寸变化时重定位（PM doc 不变,update 不会触发）
  const ro = new ResizeObserver(() => positionMask(view, uid))
  masks.set(uid, { uid, view, el, onScroll, ro, observed: null })
  positionMask(view, uid)
}

function positionMask(view: EditorView, uid: string): void {
  const m = masks.get(uid)
  if (!m || m.el.parentElement !== hostOf(view)) return
  const imgPos = findImgPos(view, uid)
  if (imgPos === null) {
    // 图片被用户删除:遮罩一并撤下
    removeMask(uid)
    return
  }
  const dom = view.nodeDOM(imgPos)
  const host = hostOf(view)
  if (!(dom instanceof HTMLElement) || !host) return
  // 观察目标跟踪（setNodeMarkup 后 img DOM 可能被重建,尺寸变化靠 RO 重定位）
  if (m.observed !== dom) {
    m.ro.disconnect()
    m.ro.observe(dom)
    m.observed = dom
    // inline img 的 ResizeObserver 不触发:加载完成(load)后必须重定位一次
    const imgEl = dom as HTMLImageElement
    if (imgEl.complete) positionMask(view, uid)
    else imgEl.addEventListener("load", () => positionMask(view, uid), { once: true })
  }
  const ir = dom.getBoundingClientRect()
  const hr = host.getBoundingClientRect()
  m.el.style.left = `${ir.left - hr.left + host.scrollLeft}px`
  m.el.style.top = `${ir.top - hr.top + host.scrollTop}px`
  m.el.style.width = `${ir.width}px`
  m.el.style.height = `${ir.height}px`
}

function relocateForView(view: EditorView): void {
  for (const m of masks.values()) {
    if (m.view === view) positionMask(view, m.uid)
  }
}

function removeMask(uid: string): void {
  const m = masks.get(uid)
  if (!m) return
  const host = hostOf(m.view)
  host?.removeEventListener('scroll', m.onScroll)
  m.ro.disconnect()
  m.el.remove()
  masks.delete(uid)
}

/* ---------- 预加载与工具 ---------- */

/** 预加载目标图入缓存（decode 后即显）。10s 兜底永不取消——decode 挂起也不能卡死替换 */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    window.setTimeout(done, 10_000)
    img.onload = () => {
      const d = img.decode?.()
      if (d) d.then(done, done)
      else done()
    }
    img.onerror = done
    img.src = src
  })
}

function toBase64Safe(buf: Uint8Array): string {
  let bin = ''
  for (let k = 0; k < buf.length; k += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(k, k + 0x8000))
  }
  return btoa(bin)
}
