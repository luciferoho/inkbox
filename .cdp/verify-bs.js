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
async function bs() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, text: String.fromCharCode(8) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
}
async function setup(text) {
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); docs.newDoc(); docs.updateContent(docs.active.id, ${JSON.stringify(text)}); docs.active.dirty = false; return 'ok' })()`)
  await ev(`${PINIA}._s.get('ui').notifyReload(); 'r'`)
  await sleep(500)
  await ev(`document.querySelector('.cm-content')?.focus(); 'f'`)
  await sleep(150)
  await ev(`${PINIA}._s.get('ui').jumpTo(1); 'j'`)
  await sleep(250)
}
const content = () => ev(`${PINIA}._s.get('documents').active.content`)
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

  // 1. 光标行首（标记前）：退格应默认（删上行字符）——文档单行时无事发生或合并
  await setup('- 内容')
  await bs(); await sleep(250)
  console.log('[标记前行首退格]:', JSON.stringify(await content()), '（应保持 - 内容，单行首行无上行）')

  // 2. `- ` 空项标记后：一次退格删整段标记
  await setup('- ')
  // 光标到行尾（标记后）
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await sleep(150)
  await bs(); await sleep(250)
  console.log('[空项标记后退格]:', JSON.stringify(await content()), '（应为空串）')

  // 3. `- 内容` 光标在标记后内容前：退格删标记保留内容
  await setup('- 内容')
  // jumpTo 行首后按 2 次 Right（越过 "- "）→ 光标在内容前
  for (let i = 0; i < 2; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await sleep(80)
  }
  await bs(); await sleep(250)
  console.log('[标记后内容前退格]:', JSON.stringify(await content()), '（应为 内容）')

  // 4. 有序标记同样处理
  await setup('12. 项目')
  for (let i = 0; i < 4; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await sleep(80)
  }
  await bs(); await sleep(250)
  console.log('[有序标记后退格]:', JSON.stringify(await content()), '（应为 项目）')

  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
