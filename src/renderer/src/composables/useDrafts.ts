import { onBeforeUnmount, onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'

/**
 * 草稿恢复：未落盘（无路径）或有未保存修改的文档，每 5 秒写入
 * userData/drafts（键 = 窗口键-标签id，多窗口互不覆写）。
 * 历史草稿只由首个窗口（w1）询问恢复——拖出标签的新窗口不接管；
 * 无论选择如何都清空旧草稿（恢复成功的标签立即由本轮询接管）。
 */
export function useDrafts(): void {
  const docs = useDocumentsStore()
  const ui = useUiStore()
  let timer: number | undefined

  function tick(): void {
    for (const tab of docs.tabs) {
      if (tab.isHome) continue
      if (tab.dirty || tab.path === null) {
        void window.api.drafts
          .save(docs.draftKey(tab.id), {
            path: tab.path,
            name: tab.name,
            content: tab.content,
            ts: Date.now()
          })
          .catch((err) => console.error('[drafts] save failed:', err))
      }
    }
  }

  onMounted(() => {
    timer = window.setInterval(tick, 5000)
    // 等 ui.init / takeInitialDoc 完成（窗口键就位）后再询问，避免打断启动
    window.setTimeout(() => {
      void (async () => {
        try {
          if (docs.windowKey !== 'w1') return // 新开窗口不接管历史草稿
          const entries = await window.api.drafts.list()
          if (entries.length === 0) return
          const names = entries.map((e) => `「${e.draft.name}」`).join('、')
          const ok = await ui.askConfirm(
            '恢复未保存的草稿',
            `检测到上次会话有 ${entries.length} 份未保存的文档：\n${names}\n要恢复它们吗？`,
            { okText: '恢复', cancelText: '丢弃' }
          )
          await window.api.drafts.clearAll()
          if (ok) docs.restoreDrafts(entries.map((e) => e.draft))
        } catch (err) {
          console.error('[drafts] restore failed:', err)
        }
      })()
    }, 800)
  })

  onBeforeUnmount(() => window.clearInterval(timer))
}
