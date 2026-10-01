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
  console.log(JSON.stringify(await ev(`(() => ({
    active: ${PINIA}._s.get('documents').active?.name,
    mode: ${PINIA}._s.get('ui').editorMode,
    tw: ${PINIA}._s.get('ui').typewriterMode,
    cmLines: document.querySelectorAll('.cm-line').length,
    cmScrollerExists: !!document.querySelector('.cm-scroller'),
    cmVisible: (() => { const el = document.querySelector('.cm-editor'); if (!el) return 'none'; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) })(),
    scrollerRect: (() => { const el = document.querySelector('.cm-scroller'); if (!el) return null; const r = el.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom) } })(),
    firstLines: [...document.querySelectorAll('.cm-line')].slice(0, 3).map(l => { const r = l.getBoundingClientRect(); return Math.round(r.top) }),
    scrollTop: Math.round(document.querySelector('.cm-scroller')?.scrollTop ?? -1)
  }))()`)))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
