<script setup lang="ts">
import { onBeforeUnmount, onMounted, defineAsyncComponent } from 'vue'
import type { UpdateStatePayload } from '@shared/types'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'
import SettingsPanel from './SettingsPanel.vue'
import Toast from './Toast.vue'

// 设置独立窗口的外壳：无边框标题栏（拖拽/关闭）+ 设置面板。
// 更新弹窗按需加载（检查更新入口在「关于」分区，弹窗也在本窗口呈现）
const UpdateDialog = defineAsyncComponent(() => import('./UpdateDialog.vue'))

const ui = useUiStore()

function close(): void {
  window.api.win.close()
}

function onKeydown(e: KeyboardEvent): void {
  // 改键录制在捕获阶段消费按键（stopPropagation），冒泡到不了这里
  if (e.key === 'Escape') close()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void ui.init()
  // 任一窗口改了全局配置（含本窗口自己的修改回包）：本窗口即时跟随
  window.api.app.onConfigChanged((cfg) => ui.applyConfig(cfg))
  // 更新状态：与主窗口同一套回显逻辑（关于页「检查更新」的 toast/弹窗都在本窗口）
  let prevUpdatePhase: UpdateStatePayload['phase'] = 'idle'
  window.api.update.onState((s) => {
    ui.updateState = s
    if (s.phase === 'available' && s.force && !ui.updateDialogOpen) ui.updateDialogOpen = true
    if (s.phase === 'none') {
      ui.updateDialogOpen = false
      if (ui.updateCheckByUser) {
        ui.updateCheckByUser = false
        ui.showToast(t('updater.upToDate'))
      }
    }
    if (s.phase === 'error' && ['downloading', 'downloaded'].includes(prevUpdatePhase)) {
      ui.showToast(t('updater.failed'))
    }
    if (s.phase === 'idle') ui.updateDialogOpen = false
    prevUpdatePhase = s.phase
  })
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="settings-window">
    <header class="sw-titlebar">
      <span class="sw-title">{{ $t('settings.title') }}</span>
      <button class="sw-close" :title="$t('settings.closeEsc')" @click="close">✕</button>
    </header>
    <main class="sw-body">
      <SettingsPanel />
    </main>
    <Toast />
    <UpdateDialog />
  </div>
</template>

<style scoped>
.settings-window {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--text);
  overflow: hidden;
}

/* 无边框窗口标题栏：整条可拖拽，仅关闭按钮可点；
   上下边框同色（--win-border 令牌，与应用窗口上边框一致、随主题联动） */
.sw-titlebar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-left: 14px;
  background: var(--bg);
  border-top: 1px solid var(--win-border);
  border-bottom: 1px solid var(--win-border);
  -webkit-app-region: drag;
}

.sw-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

.sw-close {
  width: 46px;
  height: 100%;
  margin-left: auto;
  display: grid;
  place-items: center;
  color: var(--text-2);
  font-size: 13px;
  -webkit-app-region: no-drag;
  transition: background 0.12s, color 0.12s;
}

.sw-close:hover {
  background: var(--danger);
  color: #fff;
}

.sw-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
