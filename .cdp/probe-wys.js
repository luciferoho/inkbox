let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const VBAR = `[...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  console.log('mode:', await ev(`${PINIA}._s.get('ui').editorMode`))
  console.log('prose exists:', await ev(`!!document.querySelector('.ProseMirror')`))
  console.log('prose text head:', await ev(`JSON.stringify((document.querySelector('.ProseMirror')?.textContent ?? 'NONE').slice(0, 60))`))
  console.log('milk md:', await ev(`window.__milkDebug ? __milkDebug.md().slice(0, 80) : 'no hook'`))
  console.log('bar label:', await ev(`(() => { const b = ${VBAR}; return b ? b.querySelector('.find-count').textContent + ' q=' + b.querySelector('.find-input').value : 'NO BAR' })()`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
