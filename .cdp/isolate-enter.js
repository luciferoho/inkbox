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
async function arrows(n) {
  for (let i = 0; i < n; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await sleep(60)
  }
}
const NL = 'String.fromCharCode(10)'
const content = () => ev(`${PINIA}._s.get('documents').active.content`)
async function setup(text) {
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); docs.newDoc(); docs.updateContent(docs.active.id, ${JSON.stringify(text)}); docs.active.dirty = false; return 'ok' })()`)
  await ev(`${PINIA}._s.get('ui').notifyReload(); 'r'`)
  await sleep(450)
  await ev(`${PINIA}._s.get('ui').jumpTo(1); 'j'`)
  await sleep(250)
  await ev(`document.querySelector('.cm-content')?.focus(); 'f'`)
  await sleep(120)
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(400)

  // 每个光标偏移下按一次 Enter，看产出（- 项目：offset 0=行首 1='-'后 2='- '后 4=行尾）
  for (const off of [0, 1, 2, 4]) {
    await setup('- 项目')
    await arrows(off)
    await sleep(150)
    const before = await ev(`document.querySelector('.cm-activeLine')?.textContent`)
    await enter()
    await sleep(250)
    console.log(`offset ${off}（活动行=${JSON.stringify(before)}）Enter →`, JSON.stringify(await content()))
  }
  // 空项 "- " 行尾回车
  await setup('- ')
  await ev(`(() => { const c = document.querySelector('.cm-content'); c.focus(); return 'f' })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await sleep(150)
  await enter()
  await sleep(250)
  console.log('空项 "- " 行尾 Enter →', JSON.stringify(await content()))

  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
