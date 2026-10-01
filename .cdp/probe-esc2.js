let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  // 关掉预览残留条 + 清理标签，回编辑模式开新条
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(300)
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(600)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  console.log('step A active:', await ev(`document.activeElement?.className?.slice(0, 30)`))
  console.log('step B focus input:', await ev(`(() => { const i = document.querySelector('.find-bar .find-input'); i.focus(); return document.activeElement === i ? 'ok' : 'FAIL:' + document.activeElement?.className })()`))
  await key({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await key({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(350)
  console.log('step C bars:', await ev(`document.querySelectorAll('.find-bar').length`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
