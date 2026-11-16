import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { useUiStore } from '@/stores/ui'
import { t } from '@/i18n'

/**
 * 链接悬浮提示条（5.10）：即显模式鼠标停在链接上 400ms 浮出地址条，
 * 提供「复制地址」「打开链接」两个动作；与「光标进入就地展开」互补——
 * 前者是只读可发现性提示，后者是编辑。
 *
 * - 仅在即显（PM）内；链接正文已处于就地展开编辑态时不弹（地址就在眼前）
 * - 移出链接、滚动、按下鼠标、切窗即收；提示条自身不夺焦点（mousedown prevent）
 * - 打开走与 Ctrl+单击同一链路（window.open → 主进程转系统浏览器）
 */

const SHOW_DELAY = 400
const HIDE_DELAY = 120

function hrefOf(a: HTMLAnchorElement): string {
  return (a.getAttribute('href') ?? '').trim()
}

/** 与 wysiwyg-extensions 的 openLinkTarget 同语义（该函数未导出，避免耦合内部状态） */
function openHref(href: string): void {
  const url = href.trim()
  if (!url) return
  if (/^(?:https?:\/\/|mailto:)/i.test(url)) {
    window.open(url, '_blank', 'noopener')
    return
  }
  if (url.startsWith('#')) {
    const id = decodeURIComponent(url.slice(1))
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    return
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return // luci-img 等其他协议不打开
  window.dispatchEvent(new CustomEvent('luci:open-relative-link', { detail: { href: url } }))
}

export function createLinkHoverTipPlugin(): Plugin {
  return new Plugin({
    view(editorView: EditorView) {
      const tip = document.createElement('div')
      tip.className = 'link-hover-tip'
      tip.style.display = 'none'
      document.body.appendChild(tip)

      let current: HTMLAnchorElement | null = null
      let showTimer = 0
      let hideTimer = 0
      let shownFor = ''

      const clearTimers = (): void => {
        if (showTimer) window.clearTimeout(showTimer)
        if (hideTimer) window.clearTimeout(hideTimer)
        showTimer = 0
        hideTimer = 0
      }

      const hide = (): void => {
        clearTimers()
        current = null
        shownFor = ''
        tip.style.display = 'none'
        tip.textContent = ''
      }

      const place = (a: HTMLAnchorElement): void => {
        const r = a.getBoundingClientRect()
        const w = tip.offsetWidth || 240
        let left = r.left
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
        let top = r.bottom + 6
        const h = tip.offsetHeight || 34
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
        tip.style.left = `${Math.round(left)}px`
        tip.style.top = `${Math.round(top)}px`
      }

      const build = (href: string): void => {
        tip.textContent = ''
        const url = document.createElement('span')
        url.className = 'link-hover-tip-url'
        url.textContent = href
        url.title = href
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.className = 'link-hover-tip-btn'
        copy.textContent = t('link.tipCopy')
        copy.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          void navigator.clipboard
            .writeText(href)
            .then(() => useUiStore().showToast(t('link.tipCopied')))
            .catch(() => useUiStore().showToast(t('link.tipCopyFail')))
          hide()
        })
        const open = document.createElement('button')
        open.type = 'button'
        open.className = 'link-hover-tip-btn'
        open.textContent = t('link.tipOpen')
        open.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          openHref(href)
          hide()
        })
        tip.append(url, copy, open)
      }

      const show = (a: HTMLAnchorElement, href: string): void => {
        current = a
        shownFor = href
        build(href)
        tip.style.display = ''
        place(a)
      }

      const onOver = (e: MouseEvent): void => {
        if (!editorView.hasFocus() && !editorView.dom.contains(document.activeElement)) return
        const target = e.target as HTMLElement | null
        const a = target?.closest?.('a[href]')
        if (!(a instanceof HTMLAnchorElement) || !editorView.dom.contains(a)) {
          // 指针移到非链接处：有提示就延迟收（给指针移进提示条留缓冲）
          if (current && !target?.closest?.('.link-hover-tip')) {
            if (hideTimer) window.clearTimeout(hideTimer)
            hideTimer = window.setTimeout(hide, HIDE_DELAY)
          }
          return
        }
        const href = hrefOf(a)
        if (!href) return
        // 正文已就地展开编辑（地址框在眼前）：不弹只读提示
        if (a.classList.contains('luci-link-src-text') || document.querySelector('.luci-link-src-url')) {
          hide()
          return
        }
        // 已在显示同一条链接：取消待收定时器即可
        if (current === a && shownFor === href && tip.style.display !== 'none') {
          if (hideTimer) window.clearTimeout(hideTimer)
          return
        }
        // 换了链接：旧提示立即收掉，再按延迟弹新的
        if (current && current !== a) hide()
        if (showTimer) window.clearTimeout(showTimer)
        showTimer = window.setTimeout(() => {
          if (!a.isConnected) return
          show(a, href)
        }, SHOW_DELAY)
      }

      const onLeaveTip = (): void => {
        if (hideTimer) window.clearTimeout(hideTimer)
        hideTimer = window.setTimeout(hide, HIDE_DELAY)
      }

      const onEnterTip = (): void => {
        if (hideTimer) window.clearTimeout(hideTimer)
      }

      const onScrollOrDown = (): void => hide()

      editorView.dom.addEventListener('mouseover', onOver)
      tip.addEventListener('mouseleave', onLeaveTip)
      tip.addEventListener('mouseenter', onEnterTip)
      document.addEventListener('scroll', onScrollOrDown, true)
      document.addEventListener('mousedown', onScrollOrDown, true)
      window.addEventListener('blur', hide)

      return {
        update: () => {
          // 提示条依附的链接可能被编辑移除
          if (current && (!current.isConnected || !current.getAttribute('href'))) hide()
          else if (current) place(current)
        },
        destroy: () => {
          clearTimers()
          editorView.dom.removeEventListener('mouseover', onOver)
          tip.removeEventListener('mouseleave', onLeaveTip)
          tip.removeEventListener('mouseenter', onEnterTip)
          document.removeEventListener('scroll', onScrollOrDown, true)
          document.removeEventListener('mousedown', onScrollOrDown, true)
          window.removeEventListener('blur', hide)
          tip.remove()
        }
      }
    }
  })
}
