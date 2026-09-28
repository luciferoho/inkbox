import { onBeforeUnmount, onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'

/**
 * 自动保存：定时间隔 + 窗口失焦触发；只对已落盘的脏文档生效。
 * 关键：计时起点是「上次成功保存」，第一次编辑也要等满一个间隔才存
 * （此前 lastSaved 初始为 0，首次编辑后 1 秒内就会立刻保存——这就是
 * "回车换行就提示已保存"的原因）。
 */
export function useAutosave(): void {
  const ui = useUiStore()
  const docs = useDocumentsStore()
  let timer: number | undefined
  let lastSavedAt = Date.now()

  function trySave(): void {
    const tab = docs.active
    if (!ui.autosaveEnabled || !tab?.dirty || !tab.path) return
    if (Date.now() - lastSavedAt < ui.autosaveIntervalMs) return
    lastSavedAt = Date.now()
    void docs.save()
  }

  function onBlur(): void {
    const tab = docs.active
    if (ui.autosaveEnabled && tab?.dirty && tab.path) void docs.save()
  }

  onMounted(() => {
    // 1 秒粒度轮询，实际间隔由 ui.autosaveIntervalMs 决定（设置页可即时调整）
    timer = window.setInterval(trySave, 1000)
    window.addEventListener('blur', onBlur)
  })

  onBeforeUnmount(() => {
    window.clearInterval(timer)
    window.removeEventListener('blur', onBlur)
  })
}
