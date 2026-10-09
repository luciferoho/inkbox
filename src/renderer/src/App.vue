<script setup lang="ts">
import { onMounted, nextTick, defineAsyncComponent } from 'vue'
import type { MenuCommand, UpdateStatePayload } from '@shared/types'
import { t } from '@/i18n'
import { useUiStore } from '@/stores/ui'
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
import ConfirmDialog from '@/components/chrome/ConfirmDialog.vue'
import Toast from '@/components/chrome/Toast.vue'
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
    if (backupEntries.length > 0) docs.restoreDrafts(backupEntries.map((e) => e.draft))
    if (init.windowKey === 'w1') await window.api.drafts.clearAll()
    await docs.restoreSession({
      restoreTabs: ui.restoreTabs,
      restoreFolders: ui.restoreFolders,
      crashed: init.crashed
    })
    if (backupEntries.length > 0) ui.showToast(t('app.draftsRestored', { n: backupEntries.length }))
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
    if (s.phase === 'available' && !ui.updateDialogOpen) ui.updateDialogOpen = true
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
})

/** 禅模式下的 Esc：无任何弹层时退出禅模式 */
function onZenEsc(e: KeyboardEvent): void {
  if (!ui.zenMode || e.key !== 'Escape') return
  if (ui.confirm || ui.choice || ui.viewerImage || ui.settingsOpen || ui.exportOpen) return
  ui.toggleZen()
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
    <SettingsDialog />
    <UpdateDialog />
    <ExportDialog />
    <ConfirmDialog />
    <Toast />
  </div>
</template>
