import { onBeforeUnmount, onMounted } from 'vue'
import { useDocumentsStore } from '@/stores/documents'

/**
 * 草稿兜底：5 秒周期 + 窗口失焦时把未保存/未落盘文档写入草稿。
 * 主力是编辑防抖（documents.scheduleDraftFlush，停止输入 800ms 即落），
 * 这里只兜「一直不停输入」和「写入前失焦/崩溃」的情况。
 * 草稿恢复的编排已上移到 App 启动流程（静默直接应用，无询问框）。
 */
export function useDrafts(): void {
  const docs = useDocumentsStore()
  let timer: number | undefined
  const onBlur = (): void => docs.flushDrafts()

  onMounted(() => {
    timer = window.setInterval(() => docs.flushDrafts(), 5000)
    window.addEventListener('blur', onBlur)
  })

  onBeforeUnmount(() => {
    window.clearInterval(timer)
    window.removeEventListener('blur', onBlur)
  })
}
