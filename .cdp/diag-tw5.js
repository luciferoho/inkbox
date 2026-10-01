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
const snap = () => ev(`(() => { const sc = document.querySelector('.cm-scroller'); const a = document.querySelector('.cm-activeLine'); return { st: Math.round(sc.scrollTop), at: a ? Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null } })()`)
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  // 等待会话恢复
  for (let i = 0; i < 40; i++) {
    if (await ev(`(() => { const d = ${PINIA}._s.get('documents'); return d.tabs.length > 0 })()`)) break
    await sleep(500)
  }
  await sleep(1000)
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  console.log('mode:', await ev(`${PINIA}._s.get('ui').editorMode`), '| tw:', await ev(`${PINIA}._s.get('ui').typewriterMode`))
  await ev(`${PINIA}._s.get('documents').openPath('E:/projects/lucifer/inkbox-workspace/压测-大文档.md').then(() => 'opened')`)
  await sleep(2500)
  console.log('opened:', await ev(`${PINIA}._s.get('documents').active?.name`), '| after open:', JSON.stringify(await snap()))
  await ev(`${PINIA}._s.get('ui').jumpTo(800); 'j'`)
  await sleep(900)
  console.log('jumpTo(800):', JSON.stringify(await snap()))
  await ev(`${PINIA}._s.get('ui').jumpTo(50); 'j'`)
  await sleep(900)
  console.log('jumpTo(50):', JSON.stringify(await snap()))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
