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
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`${PINIA}._s.get('ui').setEditorMode('split'); 'split'`)

  // 真实 openPath：fs 读取 + watch 登记 + CM/预览挂载 + mermaid 异步渲染
  const opened = await ev(`${PINIA}._s.get('documents').openPath('E:/projects/lucifer/inkbox-workspace/inkbox/samples/压测-大文档.md').then(() => 'opened').catch(e => 'ERR:' + e)`).catch(e => 'eval-err')
  console.log('openPath:', opened)
  const t = await ev(`(() => new Promise((resolve) => {
    const t0 = performance.now()
    let cmAt = -1, textAt = -1, svgAt = -1
    const id = setInterval(() => {
      const lines = document.querySelectorAll('.cm-line').length
      const pvLen = (document.querySelector('.md-preview')?.textContent ?? '').length
      const svg = document.querySelectorAll('.md-preview .mermaid svg').length
      const placeholders = document.querySelectorAll('.md-preview .mermaid').length
      if (cmAt < 0 && lines > 20) cmAt = performance.now() - t0
      if (textAt < 0 && pvLen > 400000) textAt = performance.now() - t0
      if (svgAt < 0 && placeholders > 0 && svg >= placeholders) svgAt = performance.now() - t0
      if ((textAt >= 0 && svgAt >= 0) || performance.now() - t0 > 120000) {
        clearInterval(id)
        resolve({ cm_ready_ms: Math.round(cmAt), preview_text_ms: Math.round(textAt), mermaid_all_ms: Math.round(svgAt), svgs: svg, placeholders })
      }
    }, 100)
  }))()`)
  console.log('真实打开:', JSON.stringify(t))

  // 大纲面板条目数（1850 个标题的联动压力）
  console.log('outline entries:', await ev(`document.querySelectorAll('.outline-item, [class*="outline"] li, [class*="outline"] .node').length`))

  // 关标签 + 清最近记录（压测文件不留痕）
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(x => x.name === '压测-大文档.md'); if (t) { t.dirty = false; docs.closeTab(t.id) } return 'closed' })()`)
  await ev(`window.api.app.getConfig().then(async (cfg) => { await window.api.app.setConfig({ recent: cfg.recent.filter(r => !r.path.includes('压测')) }); return 'recent cleaned' })`)
  await sleep(300)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`))
  console.log('recent clean:', await ev(`window.api.app.getConfig().then(c => c.recent.some(r => r.path.includes('压测')))`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
