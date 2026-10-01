let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`${PINIA}._s.get('ui').setEditorMode('split'); 'split'`)

  const opened = await ev(`${PINIA}._s.get('documents').openPath('E:/projects/lucifer/inkbox-workspace/inkbox/samples/压测-大文档.md').then(() => 'opened').catch(e => 'ERR:' + e)`)
  console.log('openPath:', opened)

  // 关键指标：文本就绪 / 首屏可见图就绪（打开体验）；后台全量完成时间另记
  const t = await ev(`(() => new Promise((resolve) => {
    const t0 = performance.now()
    let cmAt = -1, textAt = -1, firstWaveAt = -1
    const sc = document.querySelector('.preview-scroll')
    const view = sc.getBoundingClientRect()
    const id = setInterval(() => {
      const lines = document.querySelectorAll('.cm-line').length
      const pvLen = (document.querySelector('.md-preview')?.textContent ?? '').length
      const svgs = document.querySelectorAll('.md-preview .mermaid svg').length
      // 首屏预渲染量：视口内+600px 余量的图（大约 3-8 张）
      if (cmAt < 0 && lines > 20) cmAt = performance.now() - t0
      if (textAt < 0 && pvLen > 400000) textAt = performance.now() - t0
      // 队列打空且视口附近无未渲染占位 → 首屏波次完成
      if (textAt >= 0 && firstWaveAt < 0) {
        const pending2 = [...document.querySelectorAll('.md-preview .mermaid')].filter(n => {
          if (n.getAttribute('data-processed') === 'true') return false
          const r = n.getBoundingClientRect()
          return r.bottom > view.top - 600 && r.top < view.bottom + 600
        })
        if (pending2.length === 0 && svgs > 0) firstWaveAt = performance.now() - t0
      }
      if (firstWaveAt >= 0 || performance.now() - t0 > 30000) {
        clearInterval(id)
        resolve({ cm_ready_ms: Math.round(cmAt), preview_text_ms: Math.round(textAt), first_wave_ms: Math.round(firstWaveAt), svgs_now: svgs })
      }
    }, 100)
  }))()`)
  console.log('打开体验:', JSON.stringify(t))

  // 立刻量一次滚动流畅度感受点：直接跳到中部（触发懒渲染）看 5 秒内该区域是否出图
  const mid = await ev(`(() => {
    const sc = document.querySelector('.preview-scroll')
    sc.scrollTop = sc.scrollHeight / 2
    return Math.round(sc.scrollTop)
  })()`)
  await sleep(4000)
  const aroundMid = await ev(`(() => {
    const sc = document.querySelector('.preview-scroll')
    const view = sc.getBoundingClientRect()
    const all = [...document.querySelectorAll('.md-preview .mermaid')]
    let inView = 0, rendered = 0
    for (const n of all) {
      const r = n.getBoundingClientRect()
      if (r.bottom > view.top && r.top < view.bottom) { inView++; if (n.querySelector('svg')) rendered++ }
    }
    return { scrolled_to: Math.round(sc.scrollTop), in_view: inView, rendered_in_view: rendered, total_svg: document.querySelectorAll('.mermaid svg').length }
  })()`)
  console.log('跳到中部后 4s:', JSON.stringify(aroundMid))

  // 清理：关标签 + 清最近（立即回读验证）
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(x => x.name === '压测-大文档.md'); if (t) { t.dirty = false; docs.closeTab(t.id) } return 'closed' })()`)
  const cleaned = await ev(`(async () => {
    const cfg = await window.api.app.getConfig()
    await window.api.app.setConfig({ recent: cfg.recent.filter(r => !r.path.includes('压测')) })
    const after = await window.api.app.getConfig()
    return after.recent.filter(r => r.path.includes('压测')).length
  })()`)
  console.log('recent 残留:', cleaned)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
