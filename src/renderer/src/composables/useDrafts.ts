import { onBeforeUnmount, onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDocumentsStore } from '@/stores/documents'

/**
 * 草稿恢复：未落盘（无路径）或有未保存修改的文档，每 5 秒写入
 * userData/drafts；启动时若存在草稿则询问恢复，无论选择如何都清空旧草稿
 * （恢复成功的标签立即由本轮询接管；选择丢弃 = 用户明确放弃）。
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
          .save(tab.id, { path: tab.path, name: tab.name, content: tab.content, ts: Date.now() })
          .catch((err) => console.error('[drafts] save failed:', err))
      }
    }
  }

  onMounted(() => {
    timer = window.setInterval(tick, 5000)
    // 等首帧渲染稳定后再询问，避免打断启动
    window.setTimeout(() => {
      void (async () => {
        try {
          const list = await window.api.drafts.list()
          if (list.length === 0) return
          const names = list.map((d) => `「${d.name}」`).join('、')
          const ok = await ui.askConfirm(
            '恢复未保存的草稿',
            `检测到上次会话有 ${list.length} 份未保存的文档：\n${names}\n要恢复它们吗？`,
            { okText: '恢复', cancelText: '丢弃' }
          )
          await window.api.drafts.clearAll()
          if (ok) docs.restoreDrafts(list)
        } catch (err) {
          console.error('[drafts] restore failed:', err)
        }
      })()
    }, 800)
  })

  onBeforeUnmount(() => window.clearInterval(timer))
}
