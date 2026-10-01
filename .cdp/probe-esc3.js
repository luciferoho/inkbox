let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const VBAR = `[...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)`
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
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(300)
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'm'`)
  await sleep(1400)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  console.log('setup:', await ev(`(() => {
    const b = ${VBAR}
    window.__escLog = []
    b.addEventListener('keydown', (e) => window.__escLog.push('root-sees:' + e.key + ':from:' + e.target.tagName))
    return 'instrumented'
  })()`))
  console.log('dispatch on button:', await ev(`(() => {
    const b = ${VBAR}
    const btn = b.querySelector('.find-btn')
    btn.focus()
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    return JSON.stringify(window.__escLog)
  })()`))
  await sleep(400)
  console.log('bar state:', await ev(`(() => { const b = ${VBAR}; return b ? 'STILL OPEN' : 'closed' })()`))
  // CDP 真实按键到按钮上再试一次
  console.log('active:', await ev(`document.activeElement?.className`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
