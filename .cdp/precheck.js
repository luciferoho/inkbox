let ws, msgId = 0
const pending = new Map()
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  console.log(JSON.stringify(await ev(`(() => {
    const docs = ${PINIA}._s.get('documents'); const ui = ${PINIA}._s.get('ui')
    return { tabs: docs.tabs.map(t => ({ n: t.name, d: t.dirty })), active: docs.active?.name, mode: ui.editorMode, dialog: ui.confirm ? 'open' : 'none' }
  })()`)))
  // 清掉可能的挂起弹窗与脏的未命名标签
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(t => !t.path && !t.isHome); if (t) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'cleaned' })()`)
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
