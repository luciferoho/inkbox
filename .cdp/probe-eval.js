let ws, msgId = 0
const pending = new Map()
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 200)
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  const expr = `(() => {
    const docs = ${PINIA}._s.get('documents')
    const lines = Array.from({ length: 3 }, (_, i) => '行' + i)
    docs.updateContent(999, lines.join('\n\n'))
    return 'ok'
  })()`
  console.log('EXPR SOURCE:')
  console.log(expr)
  console.log('RESULT:', await ev(expr))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
