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
async function type(text) { await send('Input.insertText', { text }) }
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
const down = (o) => key({ type: 'keyDown', ...o })
const up = (o) => key({ type: 'keyUp', ...o })
async function enter() { await down({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await up({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }) }
async function ctrl(k, vk, text) { await down({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, text }); await up({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk }) }
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  // 整页 reload 后重进：新文档 + 即显
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'mode'`)
  await sleep(1500)
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'f'`)
  await type('墨匣是墨匣的墨匣'); await enter()
  await type('第二行墨匣测试')
  await sleep(300)
  const base = await ev(`document.querySelector('.ProseMirror').textContent`)
  console.log('base:', JSON.stringify(base))

  // 撤销/重做
  await type('XYZ')
  await sleep(250)
  await ctrl('z', 90, '\u001a')
  await sleep(300)
  const undone = await ev(`document.querySelector('.ProseMirror').textContent`)
  await ctrl('y', 89, '\u0019')
  await sleep(300)
  const redone = await ev(`document.querySelector('.ProseMirror').textContent`)
  await ctrl('z', 90, '\u001a')
  await sleep(300)
  console.log('undo ok:', undone === base, '| redo ok:', redone === base + 'XYZ')

  // 全部替换 → 单事务撤销
  await ctrl('f', 70, 'f')
  await sleep(350)
  await ev(`document.querySelector('.find-input')?.focus(); 'qf'`)
  await type('墨匣')
  await sleep(300)
  await ev(`document.querySelector('.find-input-repl')?.focus(); 'rf'`)
  await type('INK')
  await sleep(200)
  await ev(`[...document.querySelectorAll('.find-btn-txt')][1].click(); 'all'`)
  await sleep(400)
  const afterAll = await ev(`document.querySelector('.ProseMirror').textContent`)
  console.log('after replaceAll:', JSON.stringify(afterAll))
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'ef'`)
  await ctrl('z', 90, '\u001a')
  await sleep(400)
  const back = await ev(`document.querySelector('.ProseMirror').textContent`)
  console.log('after one-step undo:', JSON.stringify(back))
  console.log('SINGLE-STEP UNDO:', back === base)
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
