<script setup lang="ts">
import { onMounted, nextTick } from 'vue'
import type { MenuCommand } from '@shared/types'
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
import SettingsDialog from '@/components/chrome/SettingsDialog.vue'
import ExportDialog from '@/components/chrome/ExportDialog.vue'
import ConfirmDialog from '@/components/chrome/ConfirmDialog.vue'
import Toast from '@/components/chrome/Toast.vue'
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
    case 'edit:find':
      // 即显/预览模式没有源码编辑器实例，先切回双栏再开查找面板
      if (ui.editorMode === 'preview' || ui.editorMode === 'wysiwyg') {
        ui.setEditorMode('split')
      }
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
    // 恢复完成：淡出开屏页，进入应用（用户看到的直接是恢复后的界面）
    await nextTick()
    dismissSplash()
  })()
  window.api.onWinState((s) => (ui.maximized = s.maximized))
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
})

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
  <div class="app">
    <TitleBar />
    <TabsBar />
    <div class="app-body">
      <ActivityRail />
      <Transition name="sidebar">
        <div v-if="ui.sidebarOpen" class="sidebar-wrap">
          <SidePanel />
        </div>
      </Transition>
      <EditorArea />
      <Transition name="scpanel">
        <ShortcutPanel v-if="ui.shortcutPanelOpen" />
      </Transition>
    </div>
    <StatusBar />
    <ImageViewer />
    <SettingsDialog />
    <ExportDialog />
    <ConfirmDialog />
    <Toast />
  </div>
</template>
