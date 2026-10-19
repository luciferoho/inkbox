import type { EditorView } from '@codemirror/view'
import { useDocumentsStore } from '@/stores/documents'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'
import { cmViews } from './cm-registry'
import { pmViews } from './pm-registry'
import { assetsDirFor, fileExt, mimeFromName, persistImage } from './image-persist'
import { handleImages } from './pm-wysiwyg-image'

/**
 * 图片插入命令与批量上传（ROADMAP 2.5 / 2.6）：
 * - 「插入图片」：文件选择器 → 图床/.assets 共享链路 → 光标处插入，源码
 *   （CodeMirror）与即显（ProseMirror）按焦点自动选择落点；
 * - 「上传全部本地图片」：扫描活动文档中的本地相对图片链接，批量传图床
 *   （失败保持原链接），完成后 store 整档替换（ui.notifyReload 同步编辑器）。
 */

/* ---------- 上传占位符（自 SourceEditor 迁入，粘贴/命令共用） ----------
 * 纯文本占位（含唯一 id），替换按整串精确查找，用户上传期间的编辑不会破坏替换定位。 */
let uploadSeq = 0
export function withUploadingPlaceholder(
  view: EditorView,
  run: (finish: (link: string | null) => void) => Promise<void>
): Promise<void> {
  const uid = `${Date.now()}-${++uploadSeq}`
  const ph = `⏳ ${t('editor.imageUploading')} (inkbox-uploading-${uid})`
  const pos = view.state.selection.main.head
  view.dispatch({ changes: { from: pos, insert: `${ph}\n` } })
  const finish = (link: string | null): void => {
    const full = view.state.doc.toString()
    const i = full.indexOf(ph)
    if (i < 0) return // 占位符被用户删除:静默放弃
    view.dispatch({
      changes: { from: i, to: i + ph.length + 1, insert: link === null ? '' : `${link}\n` }
    })
  }
  return run(finish)
}

/** 图片文件批量落位（粘贴/拖拽/命令共用）：无文档路径提示先保存。返回是否接管。 */
export async function insertImageFiles(
  dt: DataTransfer | null,
  view: EditorView,
  event?: Event
): Promise<boolean> {
  const files = [...(dt?.files ?? [])].filter((f) => f.type.startsWith('image/'))
  if (files.length === 0) return false
  event?.preventDefault()

  const docs = useDocumentsStore()
  const tab = docs.active
  if (!tab?.path) {
    useUiStore().showToast(t('editor.saveFirstForImage'))
    return true
  }
  const docPath = tab.path
  const { assetsDir } = assetsDirFor(docPath)
  const stamp = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ts = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(
    stamp.getDate()
  )}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`

  let failed = false
  for (const [i, file] of files.entries()) {
    const name = `IMG_${ts}${files.length > 1 ? `_${i + 1}` : ''}.${fileExt(file.type)}`
    const buf = new Uint8Array(await file.arrayBuffer())
    // 占位符立即上屏;上传/落盘完成后原地替换(图床失败回退本地链接)
    await withUploadingPlaceholder(view, async (finish) => {
      const link = await persistImage({ name, type: file.type }, buf, docPath)
      if (link) finish(link)
      else {
        finish(null)
        failed = true
      }
    })
  }
  const ui = useUiStore()
  if (!ui.upload.enabled && !failed) {
    ui.showToast(t('editor.imagesInserted', { n: files.length, dir: assetsDir }))
  }
  return true
}

/** 命令落点：焦点在即显面板内 → PM；在源码面板内 → CM；都没有按模式默认 */
function pickTarget(): { kind: 'cm' | 'pm' } | null {
  const ae = document.activeElement
  for (const v of pmViews()) if (ae && v.dom.contains(ae)) return { kind: 'pm' }
  for (const v of cmViews()) if (ae && v.dom.contains(ae)) return { kind: 'cm' }
  const ui = useUiStore()
  if (ui.editorMode === 'wysiwyg' && pmViews().length > 0) return { kind: 'pm' }
  if (cmViews().length > 0) return { kind: 'cm' }
  if (pmViews().length > 0) return { kind: 'pm' }
  return null
}

/** 「插入图片」命令（ROADMAP 2.5）：原生文件选择器 → 图床/复制进 .assets → 插入光标处 */
export async function insertImageFromDisk(): Promise<void> {
  const ui = useUiStore()
  const docs = useDocumentsStore()
  const tab = docs.active
  if (!tab || tab.isHome) {
    ui.showToast(t('editor.saveFirstForImage'))
    return
  }
  // 打开原生对话框前清掉可能残留的拖拽样式：列宽/图片拖拽若在窗口外松开，
  // mouseup 丢失会让 document 上的 col-resize/禁用选择一直保留，
  // 原生对话框期间表现为光标状态异常（看不到指针位置）
  document.documentElement.style.removeProperty('cursor')
  document.documentElement.style.removeProperty('user-select')
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  await new Promise((r) => window.setTimeout(r, 30))
  const src = await window.api.dialog.openImage()
  if (!src) return
  const name = src.split(/[\\/]/).pop() ?? 'image'
  // 主进程读（base64 中转），上传或落盘都在这条链路上
  let base64: string
  try {
    base64 = await window.api.fs.readBinary(src)
  } catch (err) {
    console.error('[editor] image read failed:', err)
    ui.showToast(t('editor.imageSaveFailed', { name }))
    return
  }
  if (!tab.path) {
    ui.showToast(t('editor.saveFirstForImage'))
    return
  }
  const type = mimeFromName(name)
  const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const target = pickTarget()
  if (!target) {
    ui.showToast(t('editor.saveFirstForImage'))
    return
  }
  if (target.kind === 'pm') {
    const view = pmViews()[0]
    // 复用即显粘贴管线：占位 data: 图 + 上传遮罩 + 原地换链接
    await handleImages([new File([buf], name, { type })], view)
    view.focus()
    return
  }
  const cm = cmViews()[0]
  await withUploadingPlaceholder(cm, async (finish) => {
    const link = await persistImage({ name, type }, buf, tab.path as string)
    if (link) finish(`${link}\n`)
    else finish(null)
  })
  if (!ui.upload.enabled) {
    ui.showToast(t('editor.imagesInserted', { n: 1, dir: assetsDirFor(tab.path).assetsDir }))
  }
  cm.focus()
}

/* ---------- 上传全部本地图片（ROADMAP 2.6） ---------- */

/** 文档内图片链接（含可选标题）：![alt](url "title") */
const IMG_LINK_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

function isLocalImgUrl(url: string): boolean {
  return !/^(https?:|data:|luci-img:)/i.test(url)
}

/** 相对链接 → 绝对路径（文档目录 + 规整 ./ 前缀；内容层路径一律 / 分隔） */
function resolveLocal(docDir: string, url: string): string {
  return `${docDir}/${url.replace(/^\.\//, '')}`
}

/** 「上传全部本地图片」（ROADMAP 2.6）：批量传图床，成功者整档替换链接 */
export async function uploadAllLocalImages(): Promise<void> {
  const ui = useUiStore()
  const docs = useDocumentsStore()
  const tab = docs.active
  if (!tab || tab.isHome || !tab.path) {
    ui.showToast(t('editor.saveFirstForImage'))
    return
  }
  if (!ui.upload.enabled) {
    ui.showToast(t('editor.uploadAllNeedPicgo'))
    return
  }
  const docDir = assetsDirFor(tab.path).dir
  const urls = [...new Set([...tab.content.matchAll(IMG_LINK_RE)].map((m) => m[1]))].filter(
    isLocalImgUrl
  )
  if (urls.length === 0) {
    ui.showToast(t('editor.uploadAllNone'))
    return
  }
  let ok = 0
  let fail = 0
  let content = tab.content
  for (const url of urls) {
    const abs = resolveLocal(docDir, url)
    const name = abs.split(/[\\/]/).pop() ?? 'image'
    try {
      const b64 = await window.api.fs.readBinary(abs)
      const res = await window.api.image.upload(name, `data:${mimeFromName(name)};base64,${b64}`)
      if (res.ok && res.url) {
        for (const cand of new Set([`](${url})`, `](./${url})`])) {
          content = content.split(cand).join(`](${res.url})`)
        }
        ok++
        continue
      }
    } catch (err) {
      console.warn('[editor] uploadAll read failed:', abs, err)
    }
    fail++
  }
  if (ok === 0) {
    ui.showToast(
      fail === urls.length && urls.length > 0 ? t('editor.picgoUnreachable') : t('editor.imageUploadFailed')
    )
    return
  }
  docs.updateContent(tab.id, content)
  // 即显/源码编辑器监听 extReloadSeq，收到后整档重载
  ui.notifyReload()
  ui.showToast(
    fail > 0 ? t('editor.uploadAllPartial', { ok, fail }) : t('editor.uploadAllDone', { n: ok })
  )
}
