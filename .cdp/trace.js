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
const content = () => ev(`JSON.stringify(document.querySelector('.ProseMirror')?.textContent ?? null)`)
const barState = () => ev(`JSON.stringify({ bar: !!document.querySelector('.find-bar'), q: document.querySelector('.find-input')?.value ?? null, r: document.querySelector('.find-input-repl')?.value ?? null, hits: document.querySelectorAll('.pm-find-hit').length, cnt: document.querySelector('.find-count')?.textContent ?? null, active: document.activeElement?.className?.slice(0,30) ?? null })`)
async function type(text) { await send('Input.insertText', { text }) }
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
const down = (o) => key({ type: 'keyDown', ...o })
const up = (o) => key({ type: 'keyUp', ...o })
async function enter() { await down({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await up({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }) }
async function ctrl(k, vk, text) { await down({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, text }); await up({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk }) }
async function clickEl(sel, idx) { await ev(`(() => { const els = [...document.querySelectorAll('${sel}')]; const el = els[${idx ?? 0}]; if (!el) return 'MISSING'; el.click(); return 'clicked' })()`) }
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  // 清理环境：挂起弹窗、脏未命名标签，新建干净文档
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(t => !t.path && !t.isHome); if (t) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'mode'`)
  await sleep(1500)
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'f'`)
  await type('AAABBB'); await enter()
  await type('CCCBBBDDD')
  await sleep(300)
  console.log('T0 base:', await content())

  await type('XYZ')
  await sleep(250)
  console.log('T1 typed:', await content())
  await ctrl('z', 90, '\u001a')
  await sleep(350)
  console.log('T2 after undo:', await content(), '| bar:', await barState())
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
