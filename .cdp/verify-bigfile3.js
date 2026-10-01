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
  await ev(`${PINIA}._s.get('ui').setEditorMode('preview'); 'preview'`)
  await ev(`${PINIA}._s.get('documents').openPath('E:/projects/lucifer/inkbox-workspace/inkbox/samples/压测-大文档.md').then(() => 'opened')`)
  await sleep(1500)

  // 占位图分布 + 总高
  const info = await ev(`(() => {
    const all = [...document.querySelectorAll('.md-preview .mermaid')]
    return { total: all.length, svg: document.querySelectorAll('.mermaid svg').length, scrollH: Math.round(document.querySelector('.preview-scroll').scrollHeight), firstTop: all.length ? Math.round(all[0].offsetTop) : -1 }
  })()`)
  console.log('占位分布:', JSON.stringify(info))

  // 滚到第一张图，1.2s 内应渲染出 svg
  const r1 = await ev(`(() => {
    const sc = document.querySelector('.preview-scroll')
    const first = document.querySelector('.md-preview .mermaid')
    sc.scrollTop = first.offsetTop - 200
    return Math.round(sc.scrollTop)
  })()`)
  await sleep(1200)
  console.log('滚到第一张图后:', await ev(`(() => { const all=[...document.querySelectorAll('.md-preview .mermaid')]; return { rendered: all.filter(n=>n.querySelector('svg')).length, firstHasSvg: !!all[0].querySelector('svg') } })()`), '| scrolled', r1)

  // 快速连滚三处（模拟用户扫读），每处停 800ms，统计已渲染数变化
  for (const frac of ['0.3', '0.55', '0.8']) {
    await ev(`document.querySelector('.preview-scroll').scrollTop = document.querySelector('.preview-scroll').scrollHeight * ${frac}`)
    await sleep(800)
  }
  await sleep(1000)
  console.log('扫读三处后:', await ev(`(() => { const all=[...document.querySelectorAll('.md-preview .mermaid')]; return { rendered: all.filter(n=>n.querySelector('svg')).length, total: all.length } })()`))

  // 后台队列消化速率（10s 观察窗）
  const a = await ev(`document.querySelectorAll('.mermaid svg').length`)
  await sleep(10000)
  const b = await ev(`document.querySelectorAll('.mermaid svg').length`)
  console.log('后台 10s 渲染增量:', a, '→', b, `(${(b - a) / 10}/s)`)

  // 清理
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(x => x.name === '压测-大文档.md'); if (t) { t.dirty = false; docs.closeTab(t.id) } return 'closed' })()`)
  await ev(`(async () => { const cfg = await window.api.app.getConfig(); await window.api.app.setConfig({ recent: cfg.recent.filter(r => !r.path.includes('压测')) }); return 'cleaned' })()`)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
