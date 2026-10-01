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
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(600)
  const r = await ev(`(() => new Promise((resolve) => {
    const cm = document.querySelector('.cm-content')
    cm.focus()
    const before = ${PINIA}._s.get('documents').active.content
    const dt = new DataTransfer()
    dt.setData('text/html', '<p>~~删除线~~ 与 <del>del标签</del></p><ul><li><input type="checkbox" checked>任务项</li></ul><table><thead><tr><th>头1</th><th>头2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')
    dt.setData('text/plain', 'x')
    cm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    const id = setTimeout(() => resolve('TIMEOUT'), 4000)
    const poll = setInterval(() => {
      const now = ${PINIA}._s.get('documents').active.content
      if (now !== before) { clearInterval(poll); clearTimeout(id); resolve(now.slice(0, 200)) }
    }, 50)
  }))()`)
  console.log('gfm paste result:')
  console.log(r)
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
