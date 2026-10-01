let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
const content = () => ev(`JSON.stringify(document.querySelector('.ProseMirror')?.textContent ?? null)`)
async function type(text) { await send('Input.insertText', { text }) }
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
const down = (o) => key({ type: 'keyDown', ...o })
const up = (o) => key({ type: 'keyUp', ...o })
async function enter() { await down({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await up({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }) }
async function ctrl(k, vk, text) { await down({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, text }); await up({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk }) }
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'f'`)
  await sleep(200)
  // 当前文档是上一轮的（内容空），直接重打，正常节奏
  await type('AAABBB'); await sleep(700)
  await enter(); await sleep(700)
  await type('CCCBBBDDD'); await sleep(700)
  const base = await content()
  console.log('base:', base)

  // 打一个词（独立撤销步）
  await type('XYZ'); await sleep(700)
  await ctrl('z', 90, '\u001a'); await sleep(400)
  const afterUndo = await content()
  await ctrl('y', 89, '\u0019'); await sleep(400)
  const afterRedo = await content()
  await ctrl('z', 90, '\u001a'); await sleep(400)
  console.log('undo single step:', afterUndo === base, '| redo:', afterRedo === JSON.stringify(base.slice(1, -1) + 'XYZ'), '| back to base:', (await content()) === base)

  // 查找替换 BBB→XX，一步撤销
  await ctrl('f', 70, 'f'); await sleep(400)
  await ev(`document.querySelector('.find-input')?.focus(); 'q'`)
  await type('BBB'); await sleep(500)
  console.log('hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  await ev(`document.querySelector('.find-input-repl')?.focus(); 'r'`)
  await type('XX'); await sleep(300)
  await ev(`[...document.querySelectorAll('.find-btn-txt')][1].click(); 'all'`)
  await sleep(500)
  const afterAll = await content()
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'ef'`)
  await ctrl('z', 90, '\u001a'); await sleep(500)
  const back = await content()
  console.log('after replaceAll:', afterAll)
  console.log('after single undo:', back)
  console.log('REPLACE-ALL SINGLE-STEP UNDO:', back === base)
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
