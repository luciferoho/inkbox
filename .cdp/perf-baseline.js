let ws, msgId = 0
const pending = new Map()
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  console.log(await ev(`(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const res = performance.getEntriesByType('resource').map(r => ({ n: r.name.split('/').pop().slice(0, 44), d: Math.round(r.duration), kb: Math.round((r.transferSize || 0) / 1024) }))
    const big = res.filter(r => r.kb > 40).sort((a, b) => b.kb - a.kb).slice(0, 8)
    return JSON.stringify({
      url: location.href.slice(0, 40),
      domContentLoaded_ms: Math.round(nav.domContentLoadedEventEnd),
      loadEvent_ms: Math.round(nav.loadEventEnd),
      eagerJS_kb: res.filter(r => r.n.endsWith('.js') && !r.n.includes('chunk') ? 0 : 0, res.filter(r => r.n.endsWith('.js')).reduce((a, r) => a + r.kb, 0)),
      paint: performance.getEntriesByType('paint').map(p => p.name + ':' + Math.round(p.startTime)),
      bigResources: big,
      totalResources: res.length
    }, null, 1)
  })()`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
