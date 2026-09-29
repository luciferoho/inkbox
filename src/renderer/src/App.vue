<script setup lang="ts">
import { onMounted } from 'vue'
import type { MenuCommand } from '@shared/types'
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
        ui.showToast('请先打开要导出的文档')
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
  // 启动：应用偏好 → 取走初始文档（拖出标签的新窗口）与窗口键 → 恢复会话 → 订阅
  void (async () => {
    await ui.init()
    const init = await window.api.win.takeInitialDoc()
    docs.setWindowKey(init.windowKey)
    if (init.doc) docs.restoreDetached(init.doc)
    await docs.restoreSession(ui.restoreTabs)
  })()
  window.api.onWinState((s) => (ui.maximized = s.maximized))
  window.api.onMenuCommand(dispatch)
  // 打开文档的外部修改检测（内容比对在 documents store 里做）
  window.api.watch.onFileChanged(({ path }) => void docs.handleExternalChange(path))
})
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
