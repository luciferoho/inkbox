let ws, msgId = 0
const pending = new Map()
const logs = []
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
const content = () => ev(`${PINIA}._s.get('documents').active.content`)
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) }
    if (m.method === 'Runtime.consoleAPICalled' && JSON.stringify(m.params.args).includes('continueList')) {
      logs.push(m.params.args.map(a => a.value ?? JSON.stringify(a.value ?? '')).join(' '))
    }
  }
  await send('Runtime.enable')
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(400)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); docs.newDoc(); docs.updateContent(docs.active.id, '- 有内容'); docs.active.dirty = false; return 'ok' })()`)
  await ev(`${PINIA}._s.get('ui').notifyReload(); 'r'`)
  await sleep(500)
  await ev(`document.querySelector('.cm-content')?.focus(); 'f'`)
  await sleep(150)
  await ev(`${PINIA}._s.get('ui').jumpTo(1); 'j'`)
  await sleep(250)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await sleep(200)
  logs.length = 0
  await enter(); await sleep(400)
  console.log('B1:', JSON.stringify(await content()), '| log:', logs.shift() ?? '(未触发)')
  await enter(); await sleep(400)
  console.log('B2:', JSON.stringify(await content()), '| log:', logs.shift() ?? '(未触发)')
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
