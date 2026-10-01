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
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }

  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'mode'`)
  await sleep(1200)
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'focus'`)
  await type('墨匣是墨匣的墨匣'); await enter()
  await type('第二行墨匣测试')
  await sleep(300)

  // 探针1：点击后 DOM 选区
  const rect = await ev(`(() => { const p = document.querySelector('.ProseMirror p'); const r = p.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 } })()`)
  await clickAt(rect.x, rect.y)
  await sleep(250)
  console.log('sel after click:', JSON.stringify(await ev(`window.getSelection().toString()`)))

  // 探针2：Home + Shift+Right×2 后选区
  await down({ key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }); await up({ key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  await sleep(120)
  for (let i = 0; i < 2; i++) {
    await down({ modifiers: 8, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await up({ modifiers: 8, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await sleep(80)
  }
  console.log('sel after shift-arrows:', JSON.stringify(await ev(`window.getSelection().toString()`)))

  // 探针3：Ctrl+F 后输入框与活动元素
  await ctrl('f', 70, 'f')
  await sleep(400)
  console.log('input value:', JSON.stringify(await ev(`document.querySelector('.find-input')?.value`)))
  console.log('active:', await ev(`document.activeElement?.className`))

  // 探针4：正则开关点击后 class
  console.log('tg before:', await ev(`[...document.querySelectorAll('.find-tg')].map(b => b.className)`))
  await ev(`[...document.querySelectorAll('.find-tg')][1]?.click(); 'x'`)
  await sleep(250)
  console.log('tg after:', await ev(`[...document.querySelectorAll('.find-tg')].map(b => b.className)`))

  // 探针5：Ctrl+A + 输入正则
  await ev(`document.querySelector('.find-input')?.focus(); 'f'`)
  await ctrl('a', 65, 'a')
  await type('第.行')
  await sleep(400)
  console.log('query value:', JSON.stringify(await ev(`document.querySelector('.find-input')?.value`)))
  console.log('hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  console.log('count:', await ev(`document.querySelector('.find-count')?.textContent`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
