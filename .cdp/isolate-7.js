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
async function enter() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
const cursorInfo = () => ev(`(() => {
  const c = document.querySelectorAll('.cm-cursor')
  const sc = document.querySelector('.cm-scroller')
  return { cursors: c.length, firstCursorY: c[0] ? Math.round(c[0].getBoundingClientRect().top - sc.getBoundingClientRect().top) : null, activeLine: document.querySelector('.cm-activeLine')?.textContent ?? null }
})()`)
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); docs.newDoc(); docs.updateContent(docs.active.id, '- 有内容'); docs.active.dirty = false; return 'ok' })()`)
  await ev(`${PINIA}._s.get('ui').notifyReload(); 'r'`)
  await sleep(450)
  await ev(`${PINIA}._s.get('ui').jumpTo(1); 'j'`)
  await sleep(250)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await sleep(200)
  console.log('第一次 Enter 前:', JSON.stringify(await cursorInfo()))
  await enter()
  await sleep(300)
  console.log('第一次 Enter 后:', JSON.stringify(await cursorInfo()), '| content:', JSON.stringify(await ev(`${PINIA}._s.get('documents').active.content`)))
  await enter()
  await sleep(300)
  console.log('第二次 Enter 后:', JSON.stringify(await cursorInfo()), '| content:', JSON.stringify(await ev(`${PINIA}._s.get('documents').active.content`)))
  await send('Input.insertText', { text: '列表后' })
  await sleep(300)
  console.log('最终:', JSON.stringify(await ev(`${PINIA}._s.get('documents').active.content`)))
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
