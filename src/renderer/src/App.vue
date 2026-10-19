<script setup lang="ts">
import { onMounted, onBeforeUnmount, nextTick, defineAsyncComponent, ref } from 'vue'
import type { MenuCommand, UpdateStatePayload } from '@shared/types'
import { t } from '@/i18n'
import { canonicalizeContent } from '@/services/markdown'
import { isOpenablePath } from '@/services/openable'
import { useUiStore } from '@/stores/ui'
import { initImageContextMenu } from '@/editor/image-context-menu'
import { initTableContextMenu } from '@/editor/table-context-menu'
import { insertImageFromDisk, uploadAllLocalImages } from '@/editor/insert-image'
import { useDocumentsStore } from '@/stores/documents'
import { useWorkspaceStore } from '@/stores/workspace'
import TitleBar from '@/components/chrome/TitleBar.vue'
import TabsBar from '@/components/chrome/TabsBar.vue'
import ActivityRail from '@/components/sidebar/ActivityRail.vue'
import SidePanel from '@/components/sidebar/SidePanel.vue'
import ShortcutPanel from '@/components/sidebar/ShortcutPanel.vue'
import EditorArea from '@/components/editor/EditorArea.vue'
import StatusBar from '@/components/chrome/StatusBar.vue'
import ImageViewer from '@/components/chrome/ImageViewer.vue'
import ImageContextMenu from '@/components/chrome/ImageContextMenu.vue'
import TableContextMenu from '@/components/chrome/TableContextMenu.vue'
import ConfirmDialog from '@/components/chrome/ConfirmDialog.vue'
import Toast from '@/components/chrome/Toast.vue'
import QuickOpen from '@/components/chrome/QuickOpen.vue'
// 弹窗类按需加载（exporter 连带 pdf/字体资源链，设置页打开频率低）
const SettingsDialog = defineAsyncComponent(() => import('@/components/chrome/SettingsDialog.vue'))
const UpdateDialog = defineAsyncComponent(() => import('@/components/chrome/UpdateDialog.vue'))
const ExportDialog = defineAsyncComponent(() => import('@/components/chrome/ExportDialog.vue'))
import { useAutosave } from '@/composables/useAutosave'
import { useDrafts } from '@/composables/useDrafts'

const ui = useUiStore()
const docs = useDocumentsStore()
const ws = useWorkspaceStore()

function dispatch(cmd: MenuCommand): void {
  switch (cmd) {
    case 'file:new':
      docs.newDoc()
      break
    case 'file:open':
      void docs.openFile()
      break
    case 'file:openFolder':
      void ws.openFolder()
      break
    case 'file:save':
      void docs.save()
      break
    case 'file:saveAs':
      void docs.save(true)
      break
    case 'file:export':
      if (!docs.active || docs.active.isHome) {
        ui.showToast(t('app.exportNoDoc'))
      } else {
        ui.openExport()
      }
      break
    case 'file:insertImage':
      void insertImageFromDisk()
      break
    case 'file:uploadImages':
      void uploadAllLocalImages()
      break
    case 'file:quickOpen':
      ui.toggleQuickOpen()
      break
    case 'file:closeTab':
      docs.closeActive()
      break
    case 'file:nextTab':
      docs.cycleTab(1)
      break
    case 'file:prevTab':
      docs.cycleTab(-1)
      break
    case 'view:toggleSidebar':
      ui.toggleSidebar()
      break
    case 'view:toggleTheme':
      void ui.toggleTheme()
      break
    case 'view:toggleFocus':
      ui.toggleFocus()
      break
    case 'view:toggleTypewriter':
      ui.toggleTypewriter()
      break
    case 'view:toggleZen':
      ui.toggleZen()
      break
    case 'view:toggleSearch':
      ui.toggleSearchPanel()
      break
    case 'view:toggleShortcuts':
      // 快捷键面板在禅模式下也可用（墨脊隐藏后的唯一入口）
      ui.toggleShortcutPanel()
      break
    case 'edit:find':
      // 三模式各自打开停靠查找条：即显（PM 插件，可替换）/ 源码+双栏（CM6，可替换）/ 预览（DOM 高亮，只读）
      ui.requestFind()
      break
    case 'app:settings':
      ui.openSettings()
      break
    case 'help:sample':
      docs.openSample()
      break
  }
}

useAutosave()
useDrafts()

onMounted(() => {
  // 图片右键菜单「转 PicGo 上传」的渲染层执行端（主进程菜单发 image:picgo-upload）
  initImageContextMenu()
  // 表格右键菜单的全局识别（即显 table 元素 / 源码坐标处表格语法）
  initTableContextMenu()
  // 开屏兜底：恢复流程万一卡住，8 秒后强制进入应用
  window.setTimeout(dismissSplash, 8000)
  // 启动编排：偏好 → 初始载荷（窗口键/拖出文档/崩溃标志）→ 备份恢复 → 会话恢复
  void (async () => {
    await ui.init()
    const init = await window.api.win.takeInitialDoc()
    docs.setWindowKey(init.windowKey)
    // 窗口私有偏好（纸宽/侧栏宽）按窗口键加载；其余全局配置已在 ui.init 应用
    ui.applyWindowPrefs(await window.api.app.getWindowPrefs(init.windowKey))
    if (init.doc) docs.restoreDetached(init.doc)
    // 备份（未保存内容）仅在异常退出后直接应用；正常启动清空不留。
    // clearAll 只归首窗口：运行中拖出的新窗口不清别的窗口正在写的草稿
    const backupEntries = init.crashed ? await window.api.drafts.list() : []
    // 陈旧草稿过滤：
    // 1) 草稿写入后磁盘文件又被保存过（mtime 晚于草稿时间戳）→ 用户之后已存盘，丢弃
    // 2) 草稿与磁盘仅差序列化风格（即显回写的编号/1)/*/空段落 <br /> 等，无真实编辑）→ 丢弃
    // 都不满足才是真的未保存内容，恢复为脏标签
    const freshEntries = []
    for (const entry of backupEntries) {
      if (!entry.draft.path) {
        freshEntries.push(entry)
        continue
      }
      const mtime = await window.api.fs.mtime(entry.draft.path)
      if (mtime !== null && mtime > entry.draft.ts) {
        await window.api.drafts.clear(entry.key).catch(() => undefined)
        continue
      }
      const disk = await window.api.fs.readFile(entry.draft.path).catch(() => null)
      if (disk !== null && canonicalizeContent(disk) === canonicalizeContent(entry.draft.content)) {
        await window.api.drafts.clear(entry.key).catch(() => undefined)
        continue
      }
      freshEntries.push(entry)
    }
    if (freshEntries.length > 0) docs.restoreDrafts(freshEntries.map((e) => e.draft))
    if (init.windowKey === 'w1') await window.api.drafts.clearAll()
    await docs.restoreSession({
      restoreTabs: ui.restoreTabs,
      restoreFolders: ui.restoreFolders,
      crashed: init.crashed
    })
    if (freshEntries.length > 0) ui.showToast(t('app.draftsRestored', { n: freshEntries.length }))
    // 更新重装的启动：提示已升级 + 未保存内容已恢复（draftsRestored 提示可能已同时出现）
    const restartVersion = await window.api.update.restartVersion()
    if (restartVersion) ui.showToast(t('app.updatedRestored', { v: restartVersion }))
    // 恢复完成：淡出开屏页，进入应用（用户看到的直接是恢复后的界面）
    await nextTick()
    dismissSplash()
  })()
  window.api.onWinState((s) => {
    ui.maximized = s.maximized
    ui.alwaysOnTop = s.alwaysOnTop
  })
  // 更新状态：单源快照回显；发现新版本自动弹出更新弹窗（强制更新在弹窗内不可关闭）
  let prevUpdatePhase: UpdateStatePayload['phase'] = 'idle'
  window.api.update.onState((s) => {
    ui.updateState = s
    // 仅强制更新自动弹窗（不可关闭）;普通更新以品牌名旁的轻提示呈现,由用户点击打开
    if (s.phase === 'available' && s.force && !ui.updateDialogOpen) ui.updateDialogOpen = true
    // 已是最新：不弹窗。用户主动检查时 toast 轻提示；启动自动检查保持静默
    if (s.phase === 'none') {
      ui.updateDialogOpen = false
      if (ui.updateCheckByUser) {
        ui.updateCheckByUser = false
        ui.showToast(t('updater.upToDate'))
      }
    }
    // 下载/待装阶段出错：弹窗可能已被收起，用 toast 告知
    if (s.phase === 'error' && ['downloading', 'downloaded'].includes(prevUpdatePhase)) {
      ui.showToast(t('updater.failed'))
    }
    // 无流程可回退的空转态（网络失败且未捕获到原因）：收起弹窗避免空白
    if (s.phase === 'idle') ui.updateDialogOpen = false
    prevUpdatePhase = s.phase
  })
  window.api.onMenuCommand(dispatch)
  // 任一窗口改了全局配置（主题/语言/字号等）：本窗口即时跟随
  // （纸宽/侧栏宽是窗口私有偏好，不在广播里，各窗口互不干扰）
  window.api.app.onConfigChanged((cfg) => ui.applyConfig(cfg))
  // 手动关闭：未保存检查（WPS 式弹窗）通过后经 closeConfirmed 真正关闭
  window.api.win.onRequestClose(() => void handleRequestClose())
  // 其他窗口打开本窗口占用的文件时，激活对应标签
  window.api.doc.onActivateTab((path) => docs.activateByPath(path))
  // 打开文档的外部修改检测（内容比对在 documents store 里做）
  window.api.watch.onFileChanged(({ path }) => void docs.handleExternalChange(path))
  // 工作区目录外部变化（资源管理器增删改等）：刷新文件树（保持展开态）
  window.api.watch.onWsChanged(({ root }) => void ws.handleWsChanged(root))
  // 禅模式 Esc 退出（弹层/查看器打开时让位给它们的 Esc 处理）
  window.addEventListener('keydown', onZenEsc)
  // 拖文档文件进窗口打开（capture 先于编辑器的图片 drop 处理）
  window.addEventListener('dragenter', onWindowDragEnter, true)
  window.addEventListener('dragover', onWindowDragOver, true)
  window.addEventListener('dragleave', onWindowDragLeave, true)
  window.addEventListener('drop', onWindowDrop, true)
  window.addEventListener('dragend', resetDragHint, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onZenEsc)
  window.removeEventListener('dragenter', onWindowDragEnter, true)
  window.removeEventListener('dragover', onWindowDragOver, true)
  window.removeEventListener('dragleave', onWindowDragLeave, true)
  window.removeEventListener('drop', onWindowDrop, true)
  window.removeEventListener('dragend', resetDragHint, true)
  window.clearTimeout(dragHideTimer)
})

/** 禅模式下的 Esc：无任何弹层时退出禅模式 */
function onZenEsc(e: KeyboardEvent): void {
  if (!ui.zenMode || e.key !== 'Escape') return
  if (ui.confirm || ui.choice || ui.viewerImage || ui.settingsOpen || ui.exportOpen) return
  ui.toggleZen()
}

/* ---------- 拖文档文件进窗口打开（支持多文件） ----------
   capture 阶段拦在编辑器 drop 处理之前：编辑器只接管图片文件，文档文件归这里。
   窗口内标签拖拽带的是自定义 MIME 载荷而非 Files，不会误入此路径。
   悬停时显示「松开以打开」遮罩，替代系统默认的复制光标提示。 */
const dragOverOpen = ref(false)
const dragNames = ref<string[]>([])
let dragDepth = 0
/** 兜底隐藏：拖拽离开事件可能丢失（拖出窗口/被系统取消），无 dragover 续命即收起 */
let dragHideTimer = 0

function armDragHide(): void {
  window.clearTimeout(dragHideTimer)
  dragHideTimer = window.setTimeout(() => {
    dragDepth = 0
    dragOverOpen.value = false
    dragNames.value = []
  }, 1500)
}

function resetDragHint(): void {
  window.clearTimeout(dragHideTimer)
  dragDepth = 0
  dragOverOpen.value = false
  dragNames.value = []
}

function isDocPath(p: string): boolean {
  return isOpenablePath(p)
}

function onWindowDragEnter(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragDepth++
  dragOverOpen.value = true
  armDragHide()
}

function onWindowDragOver(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files')) return
  // 允许 drop（否则 Chromium 判定不可放置）；copy 让系统光标显示可放置
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOverOpen.value = true
  armDragHide()
  // 拖入文件名的即时预览（dragover 阶段 items 只提供文件项）
  const names = [...(e.dataTransfer?.items ?? [])]
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile()?.name ?? '')
    .filter(Boolean)
  if (names.length > 0) dragNames.value = names
}

function onWindowDragLeave(_e: DragEvent): void {
  // 离开事件的 dataTransfer 可能为空，不能按类型过滤（否则遮罩残留）
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) resetDragHint()
}

function onWindowDrop(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files')) return
  resetDragHint()
  e.preventDefault() // 恒阻止默认导航（拖入任意文件都不应让窗口跳到 file:// 页）
  const files = [...e.dataTransfer.files]
  if (files.length === 0) return
  const docPaths = window.api.win
    .pathsForFiles(files)
    .filter((p) => p && isDocPath(p))
  if (docPaths.length === 0) return // 非文档文件（图片等）放行给编辑器的 drop 处理
  e.stopPropagation()
  void (async () => {
    for (const p of docPaths) await docs.openPath(p)
  })()
}

/** 关窗流程进行中护栏：托盘退出会给每个窗口发 requestClose，防止重复弹窗 */
let closeFlowRunning = false

/** 淡出并移除 index.html 里的开屏页（启动编排完成后调用） */
function dismissSplash(): void {
  const el = document.getElementById('boot-splash')
  if (!el) return
  el.classList.add('hide')
  window.setTimeout(() => el.remove(), 300)
}

/** 主进程请求关闭（点标题栏 X / 托盘退出）：先备份最新内容，再检查未保存文档 */
async function handleRequestClose(): Promise<void> {
  if (closeFlowRunning) return
  closeFlowRunning = true
  try {
    docs.flushDrafts()
    const dirty = docs.tabs.filter((t) => !t.isHome && t.dirty)
    if (dirty.length === 0) {
      await docs.persistSessionNow() // 会话先落盘，避免退出竞态截断
      void window.api.win.closeConfirmed()
      return
    }
    const choice = await ui.askChoice(
      t('app.closeTitle'),
      t('app.closeMsg', { n: dirty.length }),
      [
        { value: 'cancel', text: t('common.cancel') },
        { value: 'discard', text: t('app.discard'), danger: true },
        { value: 'save', text: t('app.saveQuit') }
      ]
    )
    if (choice === 'cancel') return
    // 关闭确认后冻结编辑器回推与备份写入：已保存状态不能被异步事件弄脏
    docs.closing = true
    if (choice === 'save') {
      for (const t of dirty) {
        // 未命名文档走另存为（WPS 同款）；取消另存 = 留在应用
        await docs.saveTab(t, !t.path)
        if (!t.path) {
          docs.closing = false
          docs.flushDrafts()
          return
        }
      }
    } else {
      // 直接退出：丢弃未保存修改（清备份）
      for (const t of dirty) void window.api.drafts.clear(docs.draftKey(t.id))
    }
    await docs.persistSessionNow() // 会话先落盘，避免退出竞态截断
    void window.api.win.closeConfirmed()
  } finally {
    closeFlowRunning = false
  }
}
</script>

<template>
  <div class="app" :class="{ 'app-zen': ui.zenMode }">
    <TitleBar />
    <TabsBar v-if="!ui.zenMode" />
    <div class="app-body">
      <ActivityRail v-if="!ui.zenMode" />
      <Transition name="sidebar">
        <div v-if="ui.sidebarOpen && !ui.zenMode" class="sidebar-wrap">
          <SidePanel />
        </div>
      </Transition>
      <EditorArea />
      <Transition name="scpanel">
        <ShortcutPanel v-if="ui.shortcutPanelOpen" />
      </Transition>
    </div>
    <StatusBar v-if="!ui.zenMode" />
    <ImageViewer />
    <ImageContextMenu />
    <TableContextMenu />
    <SettingsDialog />
    <UpdateDialog />
    <ExportDialog />
    <ConfirmDialog />
    <QuickOpen />
    <Toast />
    <!-- 外部文档拖入提示：替代系统默认的复制提示，明确「松开即打开」 -->
    <div v-if="dragOverOpen" class="drop-hint">
      <div class="drop-hint-card">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 8V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M12 11v6M9 14l3 3 3-3" />
        </svg>
        <div class="drop-hint-title">{{ $t('app.dropOpen') }}</div>
        <div v-if="dragNames.length" class="drop-hint-names">
          {{ dragNames.slice(0, 3).join('、') }}{{ dragNames.length > 3 ? ` 等 ${dragNames.length} 个文件` : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.drop-hint {
  position: fixed;
  inset: 0;
  z-index: 200;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
}

.drop-hint-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 40px;
  border: 2px dashed var(--accent);
  border-radius: 14px;
  background: var(--surface);
  color: var(--accent-strong);
  box-shadow: 0 12px 32px rgba(15, 12, 9, 0.22);
}

.drop-hint-title {
  font-size: 14px;
  font-weight: 600;
}

.drop-hint-names {
  max-width: 420px;
  color: var(--text-2);
  font-size: 12px;
  text-align: center;
  word-break: break-all;
}
</style>
