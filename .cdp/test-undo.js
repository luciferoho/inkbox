let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
async function type(text) { await send('Input.insertText', { text }) }
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
const down = (o) => key({ type: 'keyDown', ...o })
const up = (o) => key({ type: 'keyUp', ...o })
async function ctrl(k, vk, text) { await down({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, text }); await up({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk }) }
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  // 关掉查找条，聚焦编辑器，打字后撤销
  await ev(`(() => { const b = document.querySelector('.find-bar button:last-child'); b && b.click(); return 'closed' })()`)
  await sleep(200)
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'f'`)
  const before = await ev(`document.querySelector('.ProseMirror').textContent`)
  await type('XYZTEST')
  await sleep(250)
  const after = await ev(`document.querySelector('.ProseMirror').textContent`)
  await ctrl('z', 90, '\u001a')
  await sleep(350)
  const undone = await ev(`document.querySelector('.ProseMirror').textContent`)
  console.log('before:', JSON.stringify(before))
  console.log('typed:', JSON.stringify(after))
  console.log('after Ctrl+Z:', JSON.stringify(undone))
  console.log('UNDO WORKS:', before === undone && after !== before)
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
