let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (!r) throw new Error('no result')
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}
async function type(text) { await send('Input.insertText', { text }) }
async function enter() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
async function end() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
}
async function arrowRight() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
}
const NL = 'String.fromCharCode(10)'
const content = () => ev(`${PINIA}._s.get('documents').active.content`)
async function newDocWith(text) {
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); docs.newDoc(); docs.updateContent(docs.active.id, ${JSON.stringify(text)}.split('|').join(${NL})); docs.active.dirty = false; return 'ok' })()`)
  await ev(`${PINIA}._s.get('ui').notifyReload(); 'r'`)
  await sleep(500)
  await ev(`document.querySelector('.cm-content')?.focus(); 'focus'`)
  await sleep(150)
}
async function gotoLineEnd(n) {
  await ev(`${PINIA}._s.get('ui').jumpTo(${n}); 'j'`)
  await sleep(250)
  await end()
  await sleep(150)
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
  await sleep(500)

  await newDocWith('- 第一项')
  await gotoLineEnd(1)
  await type('后缀'); await enter(); await type('第二项')
  console.log('[1] 无序续行:', JSON.stringify(await content()))

  await newDocWith('3. 三号项')
  await gotoLineEnd(1)
  await enter(); await type('四号')
  console.log('[2] 有序 3.→:', JSON.stringify(await content()))

  await newDocWith('2) 两号')
  await gotoLineEnd(1)
  await enter()
  console.log('[3] 有序 2)→:', JSON.stringify(await content()))

  await newDocWith('- [x] 已完成')
  await gotoLineEnd(1)
  await enter()
  console.log('[4] 任务 [x]→:', JSON.stringify(await content()))

  await newDocWith('> 引用一')
  await gotoLineEnd(1)
  await enter(); await type('引用二')
  console.log('[5] 引用续行:', JSON.stringify(await content()))

  await newDocWith('  - 缩进项')
  await gotoLineEnd(1)
  await enter()
  console.log('[6] 嵌套缩进:', JSON.stringify(await content()))

  await newDocWith('- 有内容')
  await gotoLineEnd(1)
  await enter()
  await enter()
  await type('列表后')
  console.log('[7] 空项结束:', JSON.stringify(await content()))

  await newDocWith('\`\`\`|1. 伪列表|\`\`\`')
  await gotoLineEnd(2)
  await enter()
  console.log('[8] 代码块内:', JSON.stringify(await content()))

  await newDocWith('- 项目')
  await ev(`${PINIA}._s.get('ui').jumpTo(1); 'j'`)
  await sleep(250)
  await arrowRight()
  await sleep(100)
  await enter()
  console.log('[9] 标记中间回车:', JSON.stringify(await content()))

  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await sleep(300)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
